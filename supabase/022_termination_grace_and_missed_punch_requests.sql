-- =========================================================================
-- Migration 022 (Phase 2) — termination 30-day grace + missed-punch
-- REQUEST flow. Run in the Supabase SQL editor AFTER 021 (needs its alert
-- table + the cron schema) and 015 (the terminate/reactivate RPCs).
-- Idempotent; safe to re-run.
--
-- ITEM 2 — termination grace ("30 days view-only paycheck + PTO, then
-- full lockout"):
--   • employee_terminate is DELIBERATELY UNTOUCHED — it never banned
--     anyone. The immediate Auth Admin ban lived in the WEB route
--     (/api/admin/employees/[id]/terminate), and THIS PR removes it
--     there. The RPC's device_sessions revocation stays (managers wanted
--     the phone signed out immediately); auth stays alive for the grace
--     window so the employee can sign back in read-only.
--   • enforce_termination_lockouts() bans (auth.users.banned_until =
--     '9999-12-31', the spec's forever value) everyone 30+ days past
--     termination, per-tenant timezone; pg_cron runs it daily at 03:00.
--   • employee_reactivate now ALSO clears banned_until in-DB, so a
--     post-lockout rehire works even without the service key (the web
--     route's Admin-API unban stays as belt and braces).
--   • Spec asked for status='terminated' — employees has NO status
--     column and termination_date has been the live signal since PR #11
--     REV 2; not adding a second source of truth.
--
-- ITEM 3 — missed-punch requests, employee-initiated and manager-decided.
--   Approval UPSERTS the timecard's punches (timecards.clock_in/out are
--   ISO-text on live) and leaves the timecard in the normal 'pending'
--   queue — tc_approve stays the ONLY thing that computes hours/lateness,
--   so the pay pipeline can't fork. Approval also resolves the shift's
--   021 alert. A request is refused only when a COMPLETE timecard exists;
--   a punch-missing timecard is exactly the case this flow repairs.
-- =========================================================================

BEGIN;

-- ── 0. Fail fast ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.missed_punch_alerts') IS NULL
     OR to_regnamespace('cron') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — apply 021 (alerts + pg_cron) first';
  END IF;
  IF to_regprocedure('public.employee_reactivate(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — apply 015 first';
  END IF;
  IF to_regprocedure('public.assert_manager_or_service()') IS NULL
     OR to_regprocedure('public.tenant_today()') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — apply 014 first';
  END IF;
  IF to_regclass('public.timecards') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — timecards missing';
  END IF;
END $$;

-- ── 1. missed_punch_requests ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS missed_punch_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  requested_clock_in timestamptz NOT NULL,
  requested_clock_out timestamptz NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'canceled')),
  decision_reason text,
  manager_decision_at timestamptz,
  manager_decision_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS missed_punch_requests_tenant_id_idx ON missed_punch_requests (tenant_id);
ALTER TABLE missed_punch_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON missed_punch_requests;
CREATE POLICY manager_full_access ON missed_punch_requests FOR ALL TO authenticated
  USING (public.is_restaurant_manager() AND tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS own_rows_select ON missed_punch_requests;
CREATE POLICY own_rows_select ON missed_punch_requests FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND employee_id = public.current_employee_id());

-- ── 2. Employee RPCs ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.missed_punch_request_submit(
  p_shift_id uuid,
  p_clock_in timestamptz,
  p_clock_out timestamptz,
  p_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_shift shifts%ROWTYPE;
  v_id uuid;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  SELECT s.* INTO v_shift FROM shifts s
  WHERE s.id = p_shift_id AND s.employee_id = v_emp
    AND s.tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;
  IF v_shift.date IS NULL OR v_shift.date > public.tenant_today() THEN
    RAISE EXCEPTION 'Missed-punch requests are for past shifts only';
  END IF;
  IF p_clock_in IS NULL OR p_clock_out IS NULL OR p_clock_out <= p_clock_in THEN
    RAISE EXCEPTION 'Clock-out must be after clock-in';
  END IF;
  IF length(coalesce(p_reason, '')) > 200 THEN
    RAISE EXCEPTION 'Reason must be 200 characters or fewer';
  END IF;
  IF EXISTS (
    SELECT 1 FROM timecards tc
    WHERE (tc.shift_id = v_shift.id
           OR (tc.employee_id = v_emp AND tc.date = v_shift.date))
      AND tc.clock_in IS NOT NULL AND tc.clock_out IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'This shift already has a complete timecard';
  END IF;
  IF EXISTS (
    SELECT 1 FROM missed_punch_requests r
    WHERE r.shift_id = v_shift.id AND r.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A request for this shift is already pending';
  END IF;

  INSERT INTO missed_punch_requests
    (employee_id, shift_id, requested_clock_in, requested_clock_out, reason, tenant_id)
  VALUES (v_emp, v_shift.id, p_clock_in, p_clock_out,
          nullif(trim(coalesce(p_reason, '')), ''), v_shift.tenant_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.missed_punch_request_cancel(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_req missed_punch_requests%ROWTYPE;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  SELECT r.* INTO v_req FROM missed_punch_requests r
  WHERE r.id = p_request_id AND r.employee_id = v_emp FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Only a pending request can be canceled (is %)', v_req.status;
  END IF;
  UPDATE missed_punch_requests SET status = 'canceled' WHERE id = v_req.id;
END;
$$;

-- ── 3. Manager RPCs ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.missed_punch_request_approve(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_req missed_punch_requests%ROWTYPE;
  v_shift shifts%ROWTYPE;
  v_tc uuid;
  v_in text;
  v_out text;
BEGIN
  PERFORM public.assert_manager_or_service();
  SELECT r.* INTO v_req FROM missed_punch_requests r
  WHERE r.id = p_request_id AND r.tenant_id = public.current_tenant_id()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Request is no longer pending (is %)', v_req.status;
  END IF;
  SELECT s.* INTO v_shift FROM shifts s WHERE s.id = v_req.shift_id;

  -- timecards store punches as ISO-8601 text on live.
  v_in  := to_char(v_req.requested_clock_in  AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_out := to_char(v_req.requested_clock_out AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  SELECT tc.id INTO v_tc FROM timecards tc
  WHERE tc.shift_id = v_req.shift_id
     OR (tc.employee_id = v_req.employee_id AND tc.date = v_shift.date)
  ORDER BY (tc.shift_id = v_req.shift_id) DESC
  LIMIT 1;

  IF v_tc IS NOT NULL THEN
    UPDATE timecards SET clock_in = v_in, clock_out = v_out WHERE id = v_tc;
  ELSE
    INSERT INTO timecards (employee_id, shift_id, date, clock_in, clock_out, status, tenant_id)
    VALUES (v_req.employee_id, v_req.shift_id, v_shift.date, v_in, v_out,
            'pending', v_req.tenant_id)
    RETURNING id INTO v_tc;
  END IF;

  UPDATE missed_punch_requests
  SET status = 'approved',
      manager_decision_at = now(),
      manager_decision_by = public.current_employee_id()
  WHERE id = v_req.id;

  -- The 021 alert for this shift is answered.
  UPDATE missed_punch_alerts SET resolved_at = now()
  WHERE shift_id = v_req.shift_id AND resolved_at IS NULL;

  -- The timecard stays 'pending' — tc_approve remains the only path that
  -- computes hours/lateness, so approval slots into the normal queue.
  RETURN jsonb_build_object('ok', true, 'timecard_id', v_tc);
END;
$$;

CREATE OR REPLACE FUNCTION public.missed_punch_request_deny(
  p_request_id uuid,
  p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_req missed_punch_requests%ROWTYPE;
BEGIN
  PERFORM public.assert_manager_or_service();
  SELECT r.* INTO v_req FROM missed_punch_requests r
  WHERE r.id = p_request_id AND r.tenant_id = public.current_tenant_id()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Request is no longer pending (is %)', v_req.status;
  END IF;
  UPDATE missed_punch_requests
  SET status = 'denied',
      decision_reason = nullif(trim(coalesce(p_reason, '')), ''),
      manager_decision_at = now(),
      manager_decision_by = public.current_employee_id()
  WHERE id = v_req.id;
END;
$$;

REVOKE ALL ON FUNCTION public.missed_punch_request_submit(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.missed_punch_request_cancel(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.missed_punch_request_approve(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.missed_punch_request_deny(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missed_punch_request_submit(uuid, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.missed_punch_request_cancel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.missed_punch_request_approve(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.missed_punch_request_deny(uuid, text) TO authenticated;

-- ── 4. Termination lockouts (grace period) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_termination_lockouts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_banned int;
BEGIN
  UPDATE auth.users u
  SET banned_until = '9999-12-31'::timestamptz
  WHERE u.id IN (
    SELECT DISTINCT e.auth_user_id
    FROM employees e
    LEFT JOIN setup st ON st.tenant_id = e.tenant_id
    WHERE e.termination_date IS NOT NULL
      AND e.auth_user_id IS NOT NULL
      AND e.termination_date + 30
          <= (now() AT TIME ZONE coalesce(st.timezone, 'America/Los_Angeles'))::date
  )
  AND (u.banned_until IS NULL OR u.banned_until < now());
  GET DIAGNOSTICS v_banned = ROW_COUNT;
  RETURN jsonb_build_object('banned', v_banned);
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_termination_lockouts() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('termination-lockouts', '0 3 * * *',
                     'SELECT public.enforce_termination_lockouts()');

-- ── 5. employee_reactivate — also lift the ban in-DB ─────────────────────
-- 015's body plus the banned_until clear (works without the service key;
-- the web route's Admin-API unban stays as belt and braces).
CREATE OR REPLACE FUNCTION public.employee_reactivate(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
BEGIN
  PERFORM public.assert_manager_or_service();

  SELECT e.* INTO v_emp FROM employees e
  WHERE e.id = p_employee_id AND e.tenant_id = public.current_tenant_id()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;
  IF v_emp.termination_date IS NULL THEN
    RAISE EXCEPTION 'Employee is not terminated';
  END IF;

  UPDATE employees SET termination_date = NULL WHERE id = v_emp.id;

  -- 022: lift any grace-period lockout too.
  IF v_emp.auth_user_id IS NOT NULL THEN
    UPDATE auth.users SET banned_until = NULL WHERE id = v_emp.auth_user_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'auth_user_id', v_emp.auth_user_id,
    'unbanned', v_emp.auth_user_id IS NOT NULL
  );
END;
$$;
REVOKE ALL ON FUNCTION employee_reactivate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION employee_reactivate(uuid) TO authenticated;

-- ── 6. Assertions ────────────────────────────────────────────────────────
DO $$
DECLARE v_def text;
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE tablename = 'missed_punch_requests'
      AND policyname IN ('manager_full_access', 'own_rows_select')) <> 2 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — missed_punch_requests policies wrong';
  END IF;
  IF to_regprocedure('public.missed_punch_request_submit(uuid, timestamptz, timestamptz, text)') IS NULL
     OR to_regprocedure('public.missed_punch_request_approve(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — missed-punch RPCs missing';
  END IF;
  IF has_function_privilege('anon', 'public.missed_punch_request_submit(uuid, timestamptz, timestamptz, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED — anon can submit missed-punch requests';
  END IF;
  IF has_function_privilege('authenticated', 'public.enforce_termination_lockouts()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED — lockout sweep callable from the API';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'termination-lockouts') THEN
    RAISE EXCEPTION 'ASSERTION FAILED — cron job termination-lockouts not registered';
  END IF;
  v_def := pg_get_functiondef(to_regprocedure('public.employee_reactivate(uuid)'));
  IF v_def NOT LIKE '%banned_until%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED — employee_reactivate does not lift bans';
  END IF;
  v_def := pg_get_functiondef(to_regprocedure('public.employee_terminate(uuid, date)'));
  IF v_def LIKE '%banned_until%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED — employee_terminate must NOT ban (grace period)';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run by hand after applying) ────────────────────────────
SELECT jobname, schedule FROM cron.job
WHERE jobname IN ('missed-punch-scan', 'termination-lockouts');
-- Grace sweep dry-run (expect {"banned": N}):
SELECT public.enforce_termination_lockouts();

-- ── Rollback (run by hand only) ──────────────────────────────────────────
-- SELECT cron.unschedule('termination-lockouts');
-- DROP FUNCTION IF EXISTS public.enforce_termination_lockouts();
-- DROP FUNCTION IF EXISTS public.missed_punch_request_submit(uuid, timestamptz, timestamptz, text);
-- DROP FUNCTION IF EXISTS public.missed_punch_request_cancel(uuid);
-- DROP FUNCTION IF EXISTS public.missed_punch_request_approve(uuid);
-- DROP FUNCTION IF EXISTS public.missed_punch_request_deny(uuid, text);
-- DROP TABLE IF EXISTS missed_punch_requests;
-- Re-apply 015's employee_reactivate section to restore the pre-022 body.

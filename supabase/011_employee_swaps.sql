-- =========================================================================
-- Migration 011 (Phase 2) — Employee swap requests.
-- Run in the Supabase SQL editor AFTER 005 + 007. Idempotent (OR REPLACE /
-- DROP IF EXISTS / IF NOT EXISTS guards); safe to re-run. One transaction.
--
-- NOTE ON NUMBERING: Phase 1 already has 011_termination_date.sql in this
-- folder. Like 005–010, this file continues the Phase 2 sequence — the
-- filenames don't collide and migrations are applied by hand.
--
-- What this does:
--   1. Extends swap_history for the employee-initiated lifecycle:
--        target_shift_id  — the target's shift offered in trade (nullable:
--                           "any of their shifts", manager picks at
--                           approval time);
--        target_accepted_at, manager_decision_at, manager_decision_by;
--        a status CHECK covering BOTH the Phase 1 manager values
--        ('pending', 'completed') and the employee flow
--        ('pending_target' → 'pending_manager' →
--         'approved'/'denied'/'declined'/'canceled').
--      The Phase 1 manager RPCs (swap_create / swap_accept / swap_cancel,
--      tier2.sql) are DELIBERATELY untouched: they implement a
--      manager-recorded reassignment (accept flips shifts.employee_id
--      immediately, cancel deletes the row) — a different animal from an
--      employee request that needs target consent + manager approval.
--      PR #10's manager approval RPC will do the actual shift
--      reassignment for 'approved' employee swaps.
--   2. Own-row SELECT policy on swap_history (initiator OR target),
--      additive to the 005 manager policy.
--   3. SECURITY DEFINER helper employee_eligible_for_swap(shift, candidate)
--      — one predicate for "who can take this shift": not terminated
--      (employees has NO active column — termination_date IS NULL is the
--      live schema's "still active" signal), not the
--      shift's owner, position matches the shift's position (candidate's
--      home_position falling back to position), member of the shift's
--      outlet by any Phase 1 signal (home_outlet_id / employee_outlets /
--      any shift there), and no conflicting shift in the window (NULL
--      times = all-day, overnight wrap ignored — same rules as 010's
--      coverage eligibility). Shared by swap_eligible_teammates AND
--      swap_request_submit so the list and the gate can never drift.
--   4. Employee RPCs: swap_request_submit / swap_request_accept /
--      swap_request_decline / swap_request_cancel / my_swap_requests /
--      swap_eligible_teammates. Row locks (FOR UPDATE) on state changes.
--   5. Fail-fast assertions; verification after COMMIT; rollback comment.
--
-- 24-HOUR CUTOFF (Adèle's rule) — timezone caveat: shifts store wall-clock
-- local times with no timezone, and the DB clock is UTC. The cutoff
-- compares (shift date + start_time) against now() + 24h both read as UTC.
-- For US tenants local time lags UTC, so the comparison trips EARLIER than
-- true-local 24h — conservative in the safe direction (never allows a swap
-- inside the real 24h window). A shift with no start_time counts from
-- midnight, also conservative. Revisit if/when setup grows a timezone.
--
-- Other deliberate choices:
--   • Trade-candidate shifts (the target's side) must ALSO be ≥24h out —
--     their schedule changes too.
--   • The eligible-teammates list shows each teammate's upcoming shifts in
--     the next 14 days as trade candidates (MVP stand-in for "this pay
--     period" — no setup dependency).
--   • Whether the initiator could actually work the target's offered shift
--     (conflicts on THEIR side) is left to manager approval — the manager
--     is the final gate in PR #10.
--   • cancel/decline KEEP the row ('canceled'/'declined') for audit —
--     unlike Phase 1 swap_cancel, which deletes.
-- =========================================================================

BEGIN;

-- ── 0. Fail-fast prerequisites ───────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  IF to_regprocedure('public.current_tenant_id()') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — current_tenant_id() missing; apply migration 005 first';
  END IF;
  IF to_regprocedure('public.current_employee_id()') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — current_employee_id() missing; apply migration 007 first';
  END IF;
  FOR t IN SELECT unnest(ARRAY['swap_history', 'shifts', 'employees']) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = t AND c.column_name = 'tenant_id'
    ) THEN
      RAISE EXCEPTION 'PREREQUISITE FAILED — % lacks tenant_id; apply migration 005 first', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'swap_history' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — RLS is disabled on swap_history; apply 004b/005 first';
  END IF;
END $$;

-- ── 1. swap_history: employee-lifecycle columns + status CHECK ───────────
ALTER TABLE swap_history
  ADD COLUMN IF NOT EXISTS target_shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL;
ALTER TABLE swap_history
  ADD COLUMN IF NOT EXISTS target_accepted_at timestamptz;
ALTER TABLE swap_history
  ADD COLUMN IF NOT EXISTS manager_decision_at timestamptz;
ALTER TABLE swap_history
  ADD COLUMN IF NOT EXISTS manager_decision_by uuid REFERENCES employees(id);

-- Replace any status CHECK that doesn't know the employee-flow values
-- (007 pattern); legacy 'pending'/'completed' rows must keep validating.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'swap_history'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%pending_target%'
  LOOP
    EXECUTE format('ALTER TABLE swap_history DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'swap_history'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  ) THEN
    ALTER TABLE swap_history ADD CONSTRAINT swap_history_status_check
      CHECK (status IN ('pending', 'completed', 'pending_target',
                        'pending_manager', 'approved', 'denied',
                        'declined', 'canceled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS swap_history_original_status_idx
  ON swap_history (original_employee_id, status);
CREATE INDEX IF NOT EXISTS swap_history_new_status_idx
  ON swap_history (new_employee_id, status);

-- ── 2. Own-row SELECT policy (initiator OR target; additive) ─────────────
DROP POLICY IF EXISTS own_rows_select ON swap_history;
CREATE POLICY own_rows_select ON swap_history FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND (original_employee_id = public.current_employee_id()
          OR new_employee_id = public.current_employee_id()));

-- ── 3. Eligibility helper (shared by list + submit) ──────────────────────
CREATE OR REPLACE FUNCTION public.employee_eligible_for_swap(
  p_shift_id uuid,
  p_candidate_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM shifts s
    JOIN employees c ON c.id = p_candidate_id
    WHERE s.id = p_shift_id
      AND s.tenant_id = public.current_tenant_id()
      AND c.tenant_id = public.current_tenant_id()
      -- still employed: NULL termination_date is the live "active" signal
      -- (there is no employees.active column). A future-dated termination
      -- also excludes — slightly strict, never wrong.
      AND c.termination_date IS NULL
      AND c.id <> s.employee_id
      -- same position as the shift being given away
      AND s.position IS NOT NULL
      AND coalesce(c.home_position, c.position) = s.position
      -- member of the shift's outlet, by any Phase 1 signal
      AND s.outlet_id IS NOT NULL
      AND (c.home_outlet_id = s.outlet_id
           OR EXISTS (SELECT 1 FROM employee_outlets eo
                      WHERE eo.employee_id = c.id AND eo.outlet_id = s.outlet_id)
           OR EXISTS (SELECT 1 FROM shifts sx
                      WHERE sx.employee_id = c.id AND sx.outlet_id = s.outlet_id))
      -- not already scheduled during that window (NULL times = all-day)
      AND NOT EXISTS (
        SELECT 1 FROM shifts s2
        WHERE s2.employee_id = c.id
          AND s2.date = s.date
          AND (s.start_time IS NULL OR s.end_time IS NULL
               OR s2.start_time IS NULL OR s2.end_time IS NULL
               OR (s2.start_time < s.end_time AND s.start_time < s2.end_time))
      )
  );
$$;

-- Wall-clock shift start for cutoff math (NULL start = midnight).
CREATE OR REPLACE FUNCTION public.shift_start_ts(p_date date, p_start time)
RETURNS timestamp
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_date + coalesce(p_start, time '00:00');
$$;

-- ── 4. swap_request_submit ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION swap_request_submit(
  p_my_shift_id uuid,
  p_target_employee_id uuid,
  p_target_shift_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_shift shifts%rowtype;
  v_their shifts%rowtype;
  v_id uuid;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  IF p_target_employee_id IS NULL THEN
    RAISE EXCEPTION 'A teammate to swap with is required';
  END IF;

  -- Ownership failure reads the same as a missing row (no existence leak).
  SELECT * INTO v_shift FROM shifts
   WHERE id = p_my_shift_id
     AND employee_id = v_emp
     AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;
  -- shifts.date is NULLABLE in the live schema; a NULL date would make the
  -- cutoff comparison NULL and silently skip the raise — fail closed.
  IF v_shift.date IS NULL THEN
    RAISE EXCEPTION 'This shift has no date — ask your manager to fix it';
  END IF;

  -- Adèle's rule: no swap requests inside 24 hours of the shift.
  IF public.shift_start_ts(v_shift.date, v_shift.start_time)
     < (now() + interval '24 hours')::timestamp THEN
    RAISE EXCEPTION 'Swaps must be requested at least 24 hours before the shift';
  END IF;

  IF NOT public.employee_eligible_for_swap(p_my_shift_id, p_target_employee_id) THEN
    RAISE EXCEPTION 'That teammate is not eligible for this swap (same position, same outlet, and free during the shift required)';
  END IF;

  IF p_target_shift_id IS NOT NULL THEN
    SELECT * INTO v_their FROM shifts
     WHERE id = p_target_shift_id
       AND employee_id = p_target_employee_id
       AND tenant_id = public.current_tenant_id();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected shift does not belong to that teammate';
    END IF;
    IF v_their.date IS NULL
       OR public.shift_start_ts(v_their.date, v_their.start_time)
          < (now() + interval '24 hours')::timestamp THEN
      RAISE EXCEPTION 'Their shift is less than 24 hours away — pick another';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM swap_history
    WHERE shift_id = p_my_shift_id
      AND status IN ('pending', 'pending_target', 'pending_manager')
  ) THEN
    RAISE EXCEPTION 'You already have a pending swap for this shift';
  END IF;

  INSERT INTO swap_history
    (shift_id, original_employee_id, new_employee_id, target_shift_id,
     status, swapped_by, tenant_id)
  VALUES
    (p_my_shift_id, v_emp, p_target_employee_id, p_target_shift_id,
     'pending_target', v_emp, public.current_tenant_id())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── 5. accept / decline / cancel ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION swap_request_accept(p_swap_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_swap swap_history%rowtype;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  SELECT * INTO v_swap FROM swap_history
   WHERE id = p_swap_id
     AND new_employee_id = v_emp
     AND tenant_id = public.current_tenant_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Swap request not found';
  END IF;
  IF v_swap.status <> 'pending_target' THEN
    RAISE EXCEPTION 'This swap is no longer awaiting your response (%)', v_swap.status;
  END IF;
  UPDATE swap_history
     SET status = 'pending_manager',
         target_accepted_at = now()
   WHERE id = p_swap_id;
END;
$$;

CREATE OR REPLACE FUNCTION swap_request_decline(p_swap_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_swap swap_history%rowtype;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  SELECT * INTO v_swap FROM swap_history
   WHERE id = p_swap_id
     AND new_employee_id = v_emp
     AND tenant_id = public.current_tenant_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Swap request not found';
  END IF;
  IF v_swap.status <> 'pending_target' THEN
    RAISE EXCEPTION 'This swap is no longer awaiting your response (%)', v_swap.status;
  END IF;
  UPDATE swap_history SET status = 'declined' WHERE id = p_swap_id;
END;
$$;

CREATE OR REPLACE FUNCTION swap_request_cancel(p_swap_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_swap swap_history%rowtype;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  -- Either party, but only before the manager has decided.
  SELECT * INTO v_swap FROM swap_history
   WHERE id = p_swap_id
     AND (original_employee_id = v_emp OR new_employee_id = v_emp)
     AND tenant_id = public.current_tenant_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Swap request not found';
  END IF;
  IF v_swap.status NOT IN ('pending_target', 'pending_manager') THEN
    RAISE EXCEPTION 'Only a pending swap can be canceled (this one is %)', v_swap.status;
  END IF;
  UPDATE swap_history SET status = 'canceled' WHERE id = p_swap_id;
END;
$$;

-- ── 6. my_swap_requests ──────────────────────────────────────────────────
-- Outgoing + incoming, with both shifts' details and the counterparty's
-- name. Pending rows always; settled rows only from the last 30 days.
DROP FUNCTION IF EXISTS my_swap_requests();

CREATE OR REPLACE FUNCTION my_swap_requests()
RETURNS TABLE (
  swap_id uuid,
  direction text,
  status text,
  counterparty_name text,
  requested_shift_id uuid,
  requested_shift_date date,
  requested_start_time time,
  requested_end_time time,
  requested_position text,
  requested_outlet_name text,
  offered_shift_id uuid,
  offered_shift_date date,
  offered_start_time time,
  offered_end_time time,
  offered_position text,
  offered_outlet_name text,
  target_accepted_at timestamptz,
  manager_decision_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;

  RETURN QUERY
  SELECT sw.id,
         CASE WHEN sw.original_employee_id = v_emp THEN 'outgoing' ELSE 'incoming' END,
         sw.status,
         CASE WHEN sw.original_employee_id = v_emp
              THEN trim(coalesce(tgt.first_name, '') || ' ' || coalesce(tgt.last_name, ''))
              ELSE trim(coalesce(org.first_name, '') || ' ' || coalesce(org.last_name, ''))
         END,
         ms.id, ms.date, ms.start_time, ms.end_time, ms.position, mo.name,
         ts.id, ts.date, ts.start_time, ts.end_time, ts.position, tou.name,
         sw.target_accepted_at,
         sw.manager_decision_at,
         sw.created_at
  FROM swap_history sw
  JOIN employees org ON org.id = sw.original_employee_id
  JOIN employees tgt ON tgt.id = sw.new_employee_id
  LEFT JOIN shifts ms  ON ms.id = sw.shift_id
  LEFT JOIN outlets mo ON mo.id = ms.outlet_id
  LEFT JOIN shifts ts  ON ts.id = sw.target_shift_id
  LEFT JOIN outlets tou ON tou.id = ts.outlet_id
  WHERE sw.tenant_id = public.current_tenant_id()
    AND (sw.original_employee_id = v_emp OR sw.new_employee_id = v_emp)
    AND (sw.status IN ('pending', 'pending_target', 'pending_manager')
         OR sw.created_at >= now() - interval '30 days')
  ORDER BY sw.created_at DESC
  LIMIT 50;
END;
$$;

-- ── 7. swap_eligible_teammates ───────────────────────────────────────────
-- One row per (eligible teammate, upcoming trade-candidate shift); shift
-- columns NULL for teammates with nothing tradeable. Candidates = their
-- shifts in the next 14 days that are themselves ≥24h out.
DROP FUNCTION IF EXISTS swap_eligible_teammates(uuid);

CREATE OR REPLACE FUNCTION swap_eligible_teammates(p_shift_id uuid)
RETURNS TABLE (
  employee_id uuid,
  employee_name text,
  employee_position text,
  shift_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  shift_position text,
  outlet_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_shift shifts%rowtype;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;

  -- refs qualified: the OUT columns (employee_id, …) would otherwise be
  -- ambiguous against the table columns under plpgsql name resolution
  SELECT sh.* INTO v_shift FROM shifts sh
   WHERE sh.id = p_shift_id
     AND sh.employee_id = v_emp
     AND sh.tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;

  RETURN QUERY
  SELECT e.id,
         trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')),
         coalesce(e.home_position, e.position),
         cs.id, cs.date, cs.start_time, cs.end_time, cs.position, o.name
  FROM employees e
  LEFT JOIN shifts cs
    ON cs.employee_id = e.id
   AND cs.date BETWEEN current_date AND current_date + 14
   AND public.shift_start_ts(cs.date, cs.start_time)
       >= (now() + interval '24 hours')::timestamp
  LEFT JOIN outlets o ON o.id = cs.outlet_id
  WHERE e.tenant_id = public.current_tenant_id()
    AND public.employee_eligible_for_swap(p_shift_id, e.id)
  ORDER BY 2, cs.date NULLS LAST, cs.start_time NULLS LAST;
END;
$$;

-- ── 8. Grants: employee-callable, and nothing else ───────────────────────
REVOKE ALL ON FUNCTION employee_eligible_for_swap(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION shift_start_ts(date, time) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION swap_request_submit(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION swap_request_accept(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION swap_request_decline(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION swap_request_cancel(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION my_swap_requests() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION swap_eligible_teammates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION employee_eligible_for_swap(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION shift_start_ts(date, time) TO authenticated;
GRANT EXECUTE ON FUNCTION swap_request_submit(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION swap_request_accept(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION swap_request_decline(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION swap_request_cancel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION my_swap_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION swap_eligible_teammates(uuid) TO authenticated;

-- ── 9. Fail-fast assertions ──────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'swap_history'
      AND column_name IN ('target_shift_id', 'target_accepted_at',
                          'manager_decision_at', 'manager_decision_by')
    HAVING count(*) = 4
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED — swap_history lifecycle columns missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'swap_history'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%pending_target%'
      AND pg_get_constraintdef(oid) ILIKE '%completed%'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED — swap_history status CHECK missing employee or legacy values';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'swap_history'
    AND policyname = 'own_rows_select'
    AND qual LIKE '%current_tenant_id%'
    AND qual LIKE '%current_employee_id%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — swap_history own_rows_select missing/unscoped';
  END IF;

  IF to_regprocedure('public.employee_eligible_for_swap(uuid, uuid)') IS NULL
     OR to_regprocedure('public.swap_request_submit(uuid, uuid, uuid)') IS NULL
     OR to_regprocedure('public.swap_request_accept(uuid)') IS NULL
     OR to_regprocedure('public.swap_request_decline(uuid)') IS NULL
     OR to_regprocedure('public.swap_request_cancel(uuid)') IS NULL
     OR to_regprocedure('public.my_swap_requests()') IS NULL
     OR to_regprocedure('public.swap_eligible_teammates(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — swap RPC(s) missing';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run after COMMIT) ──────────────────────────────────────
-- 1 row: the employee policy.
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'swap_history'
ORDER BY policyname;
-- 7 rows: the swap functions, all security definers except shift_start_ts.
SELECT proname, pg_get_function_identity_arguments(oid) AS args, prosecdef
FROM pg_proc
WHERE proname IN ('employee_eligible_for_swap', 'swap_request_submit',
                  'swap_request_accept', 'swap_request_decline',
                  'swap_request_cancel', 'my_swap_requests',
                  'swap_eligible_teammates', 'shift_start_ts')
ORDER BY proname;
-- The widened status CHECK:
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'swap_history'::regclass AND contype = 'c';
-- Smoke test — NOT from the SQL editor (no JWT → RPCs raise 'No tenant on
-- your session'). From a signed-in client:
--   supabase.rpc('my_swap_requests')
--   supabase.rpc('swap_eligible_teammates', { p_shift_id })

-- ── Rollback (run by hand only) ──────────────────────────────────────────
-- BEGIN;
-- DROP FUNCTION IF EXISTS swap_eligible_teammates(uuid);
-- DROP FUNCTION IF EXISTS my_swap_requests();
-- DROP FUNCTION IF EXISTS swap_request_cancel(uuid);
-- DROP FUNCTION IF EXISTS swap_request_decline(uuid);
-- DROP FUNCTION IF EXISTS swap_request_accept(uuid);
-- DROP FUNCTION IF EXISTS swap_request_submit(uuid, uuid, uuid);
-- DROP FUNCTION IF EXISTS shift_start_ts(date, time);
-- DROP FUNCTION IF EXISTS employee_eligible_for_swap(uuid, uuid);
-- DROP POLICY IF EXISTS own_rows_select ON swap_history;
-- -- (leave the added columns + widened CHECK: employee swap rows may exist)
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';

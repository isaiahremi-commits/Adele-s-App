-- =========================================================================
-- Migration 010 (Phase 2) — Employee callouts + coverage flow.
-- Run in the Supabase SQL editor AFTER 005 + 007 (008/009 recommended but
-- not required). Idempotent (OR REPLACE / DROP IF EXISTS / IF NOT EXISTS
-- guards); safe to re-run. One transaction — all or nothing.
--
-- What this does:
--   1. Extends callout_history with `notes` + `status`
--      ('open'/'covered'/'unresolved'; legacy manager-entered rows keep
--      NULL — they predate coverage tracking and calling them anything
--      would misrepresent history). Employee-submitted callouts land in
--      the SAME table managers already use, so the /reports counts, the
--      Pay-tab standing card, and ts_compute's called-out tip exclusion
--      all pick them up with zero extra wiring; `entered_by` is the
--      employee themselves for self-service rows.
--   2. New `coverage_requests` table — one per callout — tracking the
--      broadcast + volunteer + manager decision:
--        callout_id (unique FK), shift_id, status ('open' /
--        'volunteer_pending' / 'approved' / 'denied' / 'canceled'),
--        volunteer_employee_id, manager_decision_at/by, tenant_id.
--      RLS enabled; manager_full_access matches the 005 shape.
--      ── NOTE for future 005 re-runs: coverage_requests carries tenant_id
--      but is NOT in 005's _tenant_tables list; 005's assertion 3 (no
--      unlisted table with tenant_id) will now fail on a re-run until
--      'coverage_requests' is added to that list. Deliberate: the
--      assertion exists precisely to force this conversation.
--   3. Employee SELECT policies on coverage_requests:
--        own_rows_select — my own callout's request, or a request I
--        volunteered for;
--        eligible_open_select — OPEN requests I could cover: same
--        department as the caller-out, member of the shift's outlet
--        (home outlet, employee_outlets mapping, or any shift there),
--        no conflicting shift in that time window, not my own callout,
--        shift not in the past. All via a SECURITY DEFINER helper
--        (employee_eligible_for_coverage) because those joins read
--        shifts/employees, which employees can't freely read under RLS.
--      callout_history's own_rows_select already exists (008); it is
--      re-created here identically so this migration also stands alone.
--   4. Employee RPCs, all SECURITY DEFINER, employee inferred from
--      auth.uid(): callout_submit, coverage_available_for_me,
--      coverage_offer, coverage_withdraw, my_callouts_and_coverage.
--      coverage_offer/withdraw lock the row (FOR UPDATE) so two
--      volunteers can't race past each other.
--   5. Fail-fast assertions inside the transaction; verification after
--      COMMIT; commented rollback at the bottom.
--
-- Design notes / deliberate choices:
--   • swap_history was considered and rejected as the coverage vehicle:
--     it records a bilateral swap already agreed (original + new employee,
--     swapped_by), not an open broadcast with volunteer + manager gates.
--   • "Same outlet" for eligibility = home_outlet_id matches, OR an
--     employee_outlets mapping, OR the employee has ANY shift at that
--     outlet — the broadest signal available since outlet membership is
--     spread across all three in Phase 1 data.
--   • Conflict check treats NULL shift times as all-day (any same-date
--     shift conflicts) and ignores overnight wrap (MVP; matches the
--     scheduler which writes same-day wall-clock times).
--   • Reason/notes of a callout are NOT exposed to potential volunteers
--     (coverage_available_for_me omits them) — a teammate needs the when/
--     where, not why someone is out. The caller-out's NAME is shown.
--   • A duplicate callout for the same shift is rejected in the RPC (no
--     unique index: legacy manager-entered rows may legitimately repeat,
--     and managers stay free to enter what they need).
--   • Employee-submitted callouts feed disciplinary counts immediately —
--     that is the business rule (a callout is a callout). If a manager
--     later voids one, they delete the callout_history row exactly as
--     they would for a manual entry (PR #10 surfaces this).
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
  FOR t IN SELECT unnest(ARRAY['callout_history', 'shifts', 'employees', 'outlets']) LOOP
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
    WHERE n.nspname = 'public' AND c.relname = 'callout_history' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — RLS is disabled on callout_history; apply 004b/005 first';
  END IF;
END $$;

-- ── 1. callout_history: notes + status (additive; legacy rows stay NULL) ─
ALTER TABLE callout_history ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE callout_history ADD COLUMN IF NOT EXISTS status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'callout_history'::regclass
      AND conname = 'callout_history_status_check'
  ) THEN
    ALTER TABLE callout_history ADD CONSTRAINT callout_history_status_check
      CHECK (status IS NULL OR status IN ('open', 'covered', 'unresolved'));
  END IF;
END $$;

-- ── 2. coverage_requests ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coverage_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  callout_id uuid NOT NULL UNIQUE REFERENCES callout_history(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'volunteer_pending', 'approved', 'denied', 'canceled')),
  volunteer_employee_id uuid REFERENCES employees(id),
  manager_decision_at timestamptz,
  manager_decision_by uuid REFERENCES employees(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id) DEFAULT public.current_tenant_id(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coverage_requests_tenant_status_idx
  ON coverage_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS coverage_requests_volunteer_idx
  ON coverage_requests (volunteer_employee_id);
CREATE INDEX IF NOT EXISTS coverage_requests_shift_idx
  ON coverage_requests (shift_id);
CREATE INDEX IF NOT EXISTS callout_history_employee_status_idx
  ON callout_history (employee_id, status);

ALTER TABLE coverage_requests ENABLE ROW LEVEL SECURITY;

-- Manager policy, exact 005 shape (tenant-scoped manager check).
DROP POLICY IF EXISTS manager_full_access ON coverage_requests;
CREATE POLICY manager_full_access ON coverage_requests FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- ── 3. Eligibility helper ────────────────────────────────────────────────
-- SECURITY DEFINER: reads shifts/employees/callout_history, which the
-- caller can't freely read under their own RLS. Used by BOTH the
-- eligible_open_select policy and the offer RPC, so "what you can see" and
-- "what you can take" can never drift apart.
CREATE OR REPLACE FUNCTION public.employee_eligible_for_coverage(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM coverage_requests cr
    JOIN callout_history c ON c.id = cr.callout_id
    JOIN shifts s          ON s.id = cr.shift_id
    JOIN employees caller  ON caller.id = c.employee_id
    JOIN employees me      ON me.id = public.current_employee_id()
    WHERE cr.id = p_request_id
      AND cr.tenant_id = public.current_tenant_id()
      AND me.id <> caller.id
      AND s.date >= current_date
      -- same department: by id when set, else by the legacy text column
      AND ((me.department_id IS NOT NULL AND me.department_id = caller.department_id)
           OR (me.department IS NOT NULL AND me.department = caller.department))
      -- member of the shift's outlet, by any Phase 1 signal
      AND s.outlet_id IS NOT NULL
      AND (me.home_outlet_id = s.outlet_id
           OR EXISTS (SELECT 1 FROM employee_outlets eo
                      WHERE eo.employee_id = me.id AND eo.outlet_id = s.outlet_id)
           OR EXISTS (SELECT 1 FROM shifts sx
                      WHERE sx.employee_id = me.id AND sx.outlet_id = s.outlet_id))
      -- not already scheduled during that window (NULL times = all-day)
      AND NOT EXISTS (
        SELECT 1 FROM shifts s2
        WHERE s2.employee_id = me.id
          AND s2.date = s.date
          AND (s.start_time IS NULL OR s.end_time IS NULL
               OR s2.start_time IS NULL OR s2.end_time IS NULL
               OR (s2.start_time < s.end_time AND s.start_time < s2.end_time))
      )
  );
$$;

-- ── 4. Employee SELECT policies ──────────────────────────────────────────
-- Re-created identically to 008 so 010 also stands alone.
DROP POLICY IF EXISTS own_rows_select ON callout_history;
CREATE POLICY own_rows_select ON callout_history FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND employee_id = public.current_employee_id());

-- My own callout's request, or a request I volunteered for.
DROP POLICY IF EXISTS own_rows_select ON coverage_requests;
CREATE POLICY own_rows_select ON coverage_requests FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND (volunteer_employee_id = public.current_employee_id()
          OR EXISTS (SELECT 1 FROM callout_history c
                     WHERE c.id = coverage_requests.callout_id
                       AND c.employee_id = public.current_employee_id())));

-- Open requests I'm eligible to cover.
DROP POLICY IF EXISTS eligible_open_select ON coverage_requests;
CREATE POLICY eligible_open_select ON coverage_requests FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND status = 'open'
     AND public.employee_eligible_for_coverage(id));

-- ── 5. callout_submit ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION callout_submit(
  p_shift_id uuid,
  p_reason text,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_shift shifts%rowtype;
  v_callout uuid;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('Sick', 'Emergency', 'Personal', 'Other') THEN
    RAISE EXCEPTION 'Invalid reason';
  END IF;
  IF p_notes IS NOT NULL AND char_length(p_notes) > 200 THEN
    RAISE EXCEPTION 'Notes must be 200 characters or fewer';
  END IF;

  -- Ownership failure reads the same as a missing row (no existence leak).
  SELECT * INTO v_shift FROM shifts
   WHERE id = p_shift_id
     AND employee_id = v_emp
     AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;
  IF v_shift.date < current_date THEN
    RAISE EXCEPTION 'Cannot call out on a past shift';
  END IF;
  IF EXISTS (
    SELECT 1 FROM callout_history
    WHERE shift_id = p_shift_id AND employee_id = v_emp
  ) THEN
    RAISE EXCEPTION 'You already called out for this shift';
  END IF;

  INSERT INTO callout_history
    (employee_id, shift_id, date, reason, notes, status, entered_by, tenant_id)
  VALUES
    (v_emp, p_shift_id, v_shift.date, p_reason, p_notes, 'open', v_emp,
     public.current_tenant_id())
  RETURNING id INTO v_callout;

  INSERT INTO coverage_requests (callout_id, shift_id, status, tenant_id)
  VALUES (v_callout, p_shift_id, 'open', public.current_tenant_id());

  RETURN v_callout;
END;
$$;

-- ── 6. coverage_available_for_me ─────────────────────────────────────────
-- Open requests the caller is eligible for — the same helper the RLS
-- policy uses. Reason/notes deliberately omitted (volunteers get the
-- when/where and who, not why).
DROP FUNCTION IF EXISTS coverage_available_for_me();

CREATE OR REPLACE FUNCTION coverage_available_for_me()
RETURNS TABLE (
  request_id uuid,
  shift_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  shift_position text,
  outlet_id uuid,
  outlet_name text,
  requested_by text
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
  SELECT cr.id,
         s.id,
         s.date,
         s.start_time,
         s.end_time,
         s.position,
         s.outlet_id,
         o.name,
         trim(coalesce(caller.first_name, '') || ' ' || coalesce(caller.last_name, ''))
  FROM coverage_requests cr
  JOIN callout_history c ON c.id = cr.callout_id
  JOIN shifts s          ON s.id = cr.shift_id
  JOIN employees caller  ON caller.id = c.employee_id
  LEFT JOIN outlets o    ON o.id = s.outlet_id
  WHERE cr.tenant_id = public.current_tenant_id()
    AND cr.status = 'open'
    AND public.employee_eligible_for_coverage(cr.id)
  ORDER BY s.date, s.start_time NULLS LAST;
END;
$$;

-- ── 7. coverage_offer / coverage_withdraw ────────────────────────────────
CREATE OR REPLACE FUNCTION coverage_offer(p_coverage_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_req coverage_requests%rowtype;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;

  -- Lock the row so two volunteers can't race past each other.
  SELECT * INTO v_req FROM coverage_requests
   WHERE id = p_coverage_request_id
     AND tenant_id = public.current_tenant_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coverage request not found';
  END IF;
  IF v_req.status = 'volunteer_pending' THEN
    RAISE EXCEPTION 'Someone already volunteered for this shift';
  END IF;
  IF v_req.status <> 'open' THEN
    RAISE EXCEPTION 'This coverage request is no longer open (%)', v_req.status;
  END IF;
  IF NOT public.employee_eligible_for_coverage(p_coverage_request_id) THEN
    RAISE EXCEPTION 'You are not eligible to cover this shift';
  END IF;

  UPDATE coverage_requests
     SET volunteer_employee_id = v_emp,
         status = 'volunteer_pending'
   WHERE id = p_coverage_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION coverage_withdraw(p_coverage_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_req coverage_requests%rowtype;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;

  -- Only the current volunteer, only while the manager hasn't decided.
  SELECT * INTO v_req FROM coverage_requests
   WHERE id = p_coverage_request_id
     AND tenant_id = public.current_tenant_id()
     AND volunteer_employee_id = v_emp
     AND status = 'volunteer_pending'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coverage offer not found';
  END IF;

  UPDATE coverage_requests
     SET volunteer_employee_id = NULL,
         status = 'open'
   WHERE id = p_coverage_request_id;
END;
$$;

-- ── 8. my_callouts_and_coverage ──────────────────────────────────────────
-- Two arms: kind='callout' (my own callouts, with any volunteer's name) and
-- kind='coverage_offer' (requests I volunteered for; the caller-out's
-- reason/notes stay private — name only). Newest first, capped at 50.
DROP FUNCTION IF EXISTS my_callouts_and_coverage();

CREATE OR REPLACE FUNCTION my_callouts_and_coverage()
RETURNS TABLE (
  kind text,
  callout_id uuid,
  request_id uuid,
  shift_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  shift_position text,
  outlet_name text,
  reason text,
  notes text,
  callout_status text,
  coverage_status text,
  volunteer_name text,
  requested_by text,
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
  (
    SELECT 'callout'::text,
           c.id,
           cr.id,
           c.shift_id,
           coalesce(s.date, c.date),
           s.start_time,
           s.end_time,
           s.position,
           o.name,
           c.reason,
           c.notes,
           c.status,
           cr.status,
           trim(coalesce(v.first_name, '') || ' ' || coalesce(v.last_name, '')),
           NULL::text,
           c.created_at
    FROM callout_history c
    LEFT JOIN coverage_requests cr ON cr.callout_id = c.id
    LEFT JOIN shifts s   ON s.id = c.shift_id
    LEFT JOIN outlets o  ON o.id = s.outlet_id
    LEFT JOIN employees v ON v.id = cr.volunteer_employee_id
    WHERE c.employee_id = v_emp
      AND c.tenant_id = public.current_tenant_id()
  )
  UNION ALL
  (
    SELECT 'coverage_offer'::text,
           cr.callout_id,
           cr.id,
           cr.shift_id,
           s.date,
           s.start_time,
           s.end_time,
           s.position,
           o.name,
           NULL::text,
           NULL::text,
           NULL::text,
           cr.status,
           NULL::text,
           trim(coalesce(caller.first_name, '') || ' ' || coalesce(caller.last_name, '')),
           cr.created_at
    FROM coverage_requests cr
    JOIN callout_history c ON c.id = cr.callout_id
    JOIN employees caller  ON caller.id = c.employee_id
    LEFT JOIN shifts s     ON s.id = cr.shift_id
    LEFT JOIN outlets o    ON o.id = s.outlet_id
    WHERE cr.volunteer_employee_id = v_emp
      AND cr.tenant_id = public.current_tenant_id()
  )
  ORDER BY 16 DESC
  LIMIT 50;
END;
$$;

-- ── 9. Grants: employee-callable, and nothing else ───────────────────────
REVOKE ALL ON FUNCTION employee_eligible_for_coverage(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION callout_submit(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION coverage_available_for_me() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION coverage_offer(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION coverage_withdraw(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION my_callouts_and_coverage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION employee_eligible_for_coverage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION callout_submit(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION coverage_available_for_me() TO authenticated;
GRANT EXECUTE ON FUNCTION coverage_offer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION coverage_withdraw(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION my_callouts_and_coverage() TO authenticated;

-- Supabase grants table privileges broadly; coverage_requests writes must
-- flow through the RPCs (or manager policies) only, but keep SELECT for the
-- RLS-governed reads above.
GRANT SELECT ON coverage_requests TO authenticated;

-- ── 10. Fail-fast assertions ─────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'callout_history'
      AND column_name IN ('notes', 'status')
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED — callout_history notes/status missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'coverage_requests' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED — coverage_requests missing or RLS disabled';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'coverage_requests'
    AND policyname IN ('manager_full_access', 'own_rows_select', 'eligible_open_select')
    AND qual LIKE '%current_tenant_id%';
  IF n <> 3 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — expected 3 tenant-scoped coverage_requests policies, found %', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'coverage_requests'
      AND policyname = 'eligible_open_select'
      AND qual LIKE '%employee_eligible_for_coverage%'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED — eligible_open_select not using the eligibility helper';
  END IF;

  IF to_regprocedure('public.callout_submit(uuid, text, text)') IS NULL
     OR to_regprocedure('public.coverage_available_for_me()') IS NULL
     OR to_regprocedure('public.coverage_offer(uuid)') IS NULL
     OR to_regprocedure('public.coverage_withdraw(uuid)') IS NULL
     OR to_regprocedure('public.my_callouts_and_coverage()') IS NULL
     OR to_regprocedure('public.employee_eligible_for_coverage(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — callout/coverage RPC(s) missing';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run after COMMIT) ──────────────────────────────────────
-- 3 rows: the coverage_requests policies.
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'coverage_requests'
ORDER BY policyname;
-- 6 rows: the functions, all security definers.
SELECT proname, pg_get_function_identity_arguments(oid) AS args,
       prosecdef AS security_definer
FROM pg_proc
WHERE proname IN ('employee_eligible_for_coverage', 'callout_submit',
                  'coverage_available_for_me', 'coverage_offer',
                  'coverage_withdraw', 'my_callouts_and_coverage')
ORDER BY proname;
-- callout_history gained notes + status:
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'callout_history'
  AND column_name IN ('notes', 'status');
-- Smoke test — NOT from the SQL editor (no JWT → RPCs raise 'No tenant on
-- your session'; that raise IS the negative test). From a signed-in client:
--   supabase.rpc('coverage_available_for_me')
--   supabase.rpc('my_callouts_and_coverage')

-- ── Rollback (run by hand only) ──────────────────────────────────────────
-- BEGIN;
-- DROP FUNCTION IF EXISTS my_callouts_and_coverage();
-- DROP FUNCTION IF EXISTS coverage_withdraw(uuid);
-- DROP FUNCTION IF EXISTS coverage_offer(uuid);
-- DROP FUNCTION IF EXISTS coverage_available_for_me();
-- DROP FUNCTION IF EXISTS callout_submit(uuid, text, text);
-- DROP POLICY IF EXISTS eligible_open_select ON coverage_requests;
-- DROP POLICY IF EXISTS own_rows_select ON coverage_requests;
-- DROP FUNCTION IF EXISTS employee_eligible_for_coverage(uuid);
-- DROP TABLE IF EXISTS coverage_requests;
-- -- (leave callout_history.notes/status: employee-submitted rows may exist)
-- -- (own_rows_select on callout_history stays — 008 owns it)
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';

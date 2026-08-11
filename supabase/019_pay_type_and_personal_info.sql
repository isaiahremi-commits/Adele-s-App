-- =========================================================================
-- Migration 019 (Phase 2) — pay-type-driven tips + self-onboarding fields
-- + running-late signals + end-of-day reports.
-- Run in the Supabase SQL editor AFTER 017 (tipped positions) and 018
-- (schedule RLS); the full applied chain is assumed. Idempotent.
-- (Phase 2 series 019 — distinct from the legacy Phase 1
-- 019_tip_compute_case_insensitive.sql.)
--
-- WHY (Adèle, Aug 11): tipped-ness follows PAY TYPE now, not position —
-- every HOURLY employee is tipped (kitchen included: culinary service
-- charge), salaried employees and managers are not. Employees also
-- self-fill their personal info on first sign-in (managers stop typing
-- DOBs), the Home tab gets a "Running late" signal, and the manager
-- End-of-day wizard needs a place to land.
--
-- DEVIATIONS FROM THE SPEC SHEET (live schema forced them):
--   • date_of_birth / phone / pay_type / annual_salary already exist on
--     live employees (PR #13 wizard writes them) — ADD COLUMN IF NOT
--     EXISTS covers both worlds.
--   • "tshirt_size": live already has shirt_size (Phase 1, 009_shirt_size)
--     — REUSED instead of adding a duplicate column. The RPC still takes
--     p_tshirt_size and writes shirt_size.
--   • pay_type backfill: live pay_type is NOT NULL with DELIBERATE values
--     (the wizard has been setting it since PR #13). The spec'd inference
--     ("annual_salary present OR regular_rate null → salary") runs ONLY on
--     rows where pay_type IS NULL — on live that is zero rows; on a fresh
--     chain it fills everything. Blindly re-inferring would flip an hourly
--     employee with a not-yet-set rate to salary and hide their tip UI.
--   • has_completed_self_onboarding backfills TRUE only when this
--     migration CREATES the column — a re-run must not flip post-019
--     hires who genuinely haven't self-onboarded.
--   • NEW (needed by the PR #18 app work, absent from the spec's schema
--     list): late_signals (the "Running late" record — delivery stays
--     manual until push lands in PR #19) and eod_reports (End-of-day
--     wizard submissions; UNIQUE per tenant+date).
--   • 005 re-run caveat (same as coverage_requests/broadcasts):
--     late_signals + eod_reports carry tenant_id but are not in 005's
--     _tenant_tables list yet.
--
-- TIP-ENGINE CHANGE: employee_is_tipped() is REDEFINED (it is 017's
-- function, small, we own it) — false for salary/manager/unlinked, true
-- otherwise; outlet_roles.is_tipped is NO LONGER CONSULTED (the column
-- stays for back-compat). ts_compute's 017 guard is SWAPPED in place via
-- pg_get_functiondef (the 016/017 pattern): the _ts_elig filter
-- `coalesce(orl.is_tipped, true)` becomes
-- `coalesce(emp.pay_type, 'hourly') <> 'salary'`. Consequences: salaried
-- staff are zeroed out of pools/mini-pools/declared bases; hourly staff at
-- positions Adèle had toggled non-tipped REJOIN the distribution (her new
-- rule) — and therefore need outlet_roles points config again or the
-- engine raises its usual Missing-points error (fail-loud, unchanged).
-- =========================================================================

BEGIN;

-- ── 0. Fail fast if the chain isn't applied ──────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.current_tenant_id()') IS NULL
     OR to_regprocedure('public.current_employee_id()') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — apply 005/007 first';
  END IF;
  IF to_regprocedure('public.employee_is_tipped(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — employee_is_tipped missing; apply 017 first';
  END IF;
  IF to_regprocedure('public.ts_compute_unguarded(uuid)') IS NULL
     AND to_regprocedure('public.ts_compute(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — tip engine missing';
  END IF;
  IF to_regprocedure('public.tenant_today()') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — tenant_today missing; apply 014 first';
  END IF;
  IF to_regprocedure('public.is_restaurant_manager()') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — is_restaurant_manager missing; apply 005 first';
  END IF;
END $$;

-- ── 1. Columns (live already has several — IF NOT EXISTS throughout) ─────
DO $$
DECLARE
  v_flag_is_new boolean;
  v_paytype_was_missing boolean;
  n int;
BEGIN
  v_flag_is_new := NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employees'
      AND column_name = 'has_completed_self_onboarding');
  v_paytype_was_missing := NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employees'
      AND column_name = 'pay_type');

  ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth date;
  ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone text;
  ALTER TABLE employees ADD COLUMN IF NOT EXISTS home_address text;
  ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_name text;
  ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_phone text;
  ALTER TABLE employees ADD COLUMN IF NOT EXISTS shirt_size text;  -- spec's tshirt_size
  ALTER TABLE employees ADD COLUMN IF NOT EXISTS pay_type text;
  ALTER TABLE employees ADD COLUMN IF NOT EXISTS annual_salary numeric;
  ALTER TABLE employees ADD COLUMN IF NOT EXISTS has_completed_self_onboarding boolean NOT NULL DEFAULT false;

  -- Backfill A: pay_type inference — NULL rows only (see header).
  UPDATE employees
     SET pay_type = CASE WHEN annual_salary IS NOT NULL OR regular_rate IS NULL
                         THEN 'salary' ELSE 'hourly' END
   WHERE pay_type IS NULL;

  -- Defensive normalize, then pin with a CHECK. Audit first: fail loudly
  -- with the offending values rather than letting ADD CONSTRAINT throw
  -- something opaque.
  UPDATE employees SET pay_type = lower(pay_type) WHERE pay_type <> lower(pay_type);
  SELECT count(*) INTO n FROM employees WHERE pay_type NOT IN ('salary', 'hourly');
  IF n > 0 THEN
    RAISE EXCEPTION 'PRE-AUDIT FAILED — % employees rows with pay_type outside salary/hourly: %',
      n, (SELECT string_agg(DISTINCT pay_type, ', ') FROM employees
          WHERE pay_type NOT IN ('salary', 'hourly'));
  END IF;
  ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_pay_type_check;
  ALTER TABLE employees ADD CONSTRAINT employees_pay_type_check
    CHECK (pay_type IN ('salary', 'hourly'));
  IF v_paytype_was_missing THEN
    ALTER TABLE employees ALTER COLUMN pay_type SET DEFAULT 'hourly';
    ALTER TABLE employees ALTER COLUMN pay_type SET NOT NULL;
  END IF;

  -- Backfill B: everyone who exists BEFORE this migration has been active
  -- long since — only first-apply flips them (re-runs must not).
  IF v_flag_is_new THEN
    UPDATE employees SET has_completed_self_onboarding = true;
  END IF;
END $$;

-- ── 2. employee_is_tipped v2 — pay_type is the sole driver ───────────────
-- Full redefine (017's function, we own it). Same fail-safe posture:
-- returns false rather than raising; non-managers only ask about self.
-- outlet_roles.is_tipped is deliberately no longer consulted.
CREATE OR REPLACE FUNCTION public.employee_is_tipped(
  p_employee_id uuid DEFAULT public.current_employee_id()
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%rowtype;
BEGIN
  IF p_employee_id IS NULL THEN
    RETURN false;
  END IF;
  IF p_employee_id IS DISTINCT FROM public.current_employee_id()
     AND coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     AND NOT public.is_restaurant_manager() THEN
    RETURN false;
  END IF;

  SELECT * INTO v_emp
  FROM employees
  WHERE id = p_employee_id
    AND (tenant_id = public.current_tenant_id()
         OR coalesce(auth.jwt() ->> 'role', '') = 'service_role');
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_emp.title = 'Restaurant Manager' THEN
    RETURN false;
  END IF;
  -- 019: salaried employees are never tipped; every hourly employee IS
  -- (kitchen included — culinary service charge, Adèle's rule).
  IF v_emp.pay_type = 'salary' THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.employee_is_tipped(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_is_tipped(uuid) TO authenticated, service_role;

-- ── 3. Swap ts_compute's 017 guard for the pay-type guard ────────────────
DO $$
DECLARE
  v_target regprocedure;
  v_def    text;
  v_old constant text := 'and coalesce(orl.is_tipped, true);';
  v_new constant text := $g$and coalesce(emp.pay_type, 'hourly') <> 'salary';$g$;
BEGIN
  v_target := coalesce(to_regprocedure('public.ts_compute_unguarded(uuid)'),
                       to_regprocedure('public.ts_compute(uuid)'));
  v_def := pg_get_functiondef(v_target);
  IF position('_ts_elig' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — % is not the tip engine; refusing to patch', v_target;
  END IF;
  IF position('emp.pay_type' IN v_def) > 0 THEN
    RAISE NOTICE '% already pay-type driven — skipping patch', v_target;
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — expected exactly one 017 guard in %; patch by hand', v_target;
  END IF;
  v_def := replace(v_def, v_old, v_new);
  -- Retire 017's comment lines too, if still verbatim (best-effort).
  v_def := replace(v_def,
    '-- 017: non-tipped positions sit out the distribution entirely;',
    '-- 019: salaried employees sit out the distribution entirely');
  v_def := replace(v_def,
    '-- unmatched positions (orl is NULL) keep pre-017 behavior.',
    '-- (pay-type driven; outlet_roles.is_tipped no longer consulted).');
  EXECUTE v_def;
END $$;

-- ── 4. employee_self_onboard — the employee fills their own file ─────────
-- NOT manager-gated: runs as the employee, writes ONLY their own row
-- (the id comes from auth.uid via current_employee_id — there is no way
-- to point it at someone else). Phone + emergency contact required, the
-- rest optional. Mutation → unlinked callers RAISE (016 rule).
CREATE OR REPLACE FUNCTION public.employee_self_onboard(
  p_dob date DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_emergency_name text DEFAULT NULL,
  p_emergency_phone text DEFAULT NULL,
  p_tshirt_size text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  IF nullif(trim(coalesce(p_phone, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A phone number is required';
  END IF;
  IF nullif(trim(coalesce(p_emergency_name, '')), '') IS NULL
     OR nullif(trim(coalesce(p_emergency_phone, '')), '') IS NULL THEN
    RAISE EXCEPTION 'An emergency contact name and phone are required';
  END IF;

  UPDATE employees SET
    date_of_birth           = coalesce(p_dob, date_of_birth),
    phone                   = trim(p_phone),
    home_address            = coalesce(nullif(trim(coalesce(p_address, '')), ''), home_address),
    emergency_contact_name  = trim(p_emergency_name),
    emergency_contact_phone = trim(p_emergency_phone),
    shirt_size              = coalesce(nullif(trim(coalesce(p_tshirt_size, '')), ''), shirt_size),
    has_completed_self_onboarding = true
  WHERE id = v_emp;

  RETURN jsonb_build_object('employee_id', v_emp, 'completed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.employee_self_onboard(date, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_self_onboard(date, text, text, text, text, text) TO authenticated;

-- ── 5. late_signals + running_late_submit ────────────────────────────────
-- Recording only — delivery is Adèle reading it / broadcasts until push
-- lands (PR #19). Employees insert via the RPC and read their own rows;
-- managers read everything.
CREATE TABLE IF NOT EXISTS late_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL,
  date date NOT NULL,
  minutes_late int NOT NULL CHECK (minutes_late BETWEEN 1 AND 480),
  created_at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS late_signals_tenant_id_idx ON late_signals (tenant_id);
ALTER TABLE late_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON late_signals;
CREATE POLICY manager_full_access ON late_signals FOR ALL TO authenticated
  USING (public.is_restaurant_manager() AND tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS own_rows_select ON late_signals;
CREATE POLICY own_rows_select ON late_signals FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND employee_id = public.current_employee_id());

CREATE OR REPLACE FUNCTION public.running_late_submit(
  p_minutes int,
  p_shift_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_id uuid;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  IF p_minutes IS NULL OR p_minutes < 1 OR p_minutes > 480 THEN
    RAISE EXCEPTION 'Minutes late must be between 1 and 480';
  END IF;
  -- If a shift id is passed it must be the caller's own.
  IF p_shift_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM shifts WHERE id = p_shift_id AND employee_id = v_emp
  ) THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;

  INSERT INTO late_signals (employee_id, shift_id, date, minutes_late, tenant_id)
  VALUES (v_emp, p_shift_id, public.tenant_today(), p_minutes, public.current_tenant_id())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.running_late_submit(int, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.running_late_submit(int, uuid) TO authenticated;

-- ── 6. eod_reports — End-of-day wizard submissions ───────────────────────
-- Manager-only surface; one report per tenant per day. Writes go through
-- manager_full_access directly (no RPC needed — the client inserts under
-- the manager's own RLS).
CREATE TABLE IF NOT EXISTS eod_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date date NOT NULL,
  notes text,
  submitted_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES tenants(id),
  UNIQUE (tenant_id, report_date)
);
CREATE INDEX IF NOT EXISTS eod_reports_tenant_id_idx ON eod_reports (tenant_id);
ALTER TABLE eod_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON eod_reports;
CREATE POLICY manager_full_access ON eod_reports FOR ALL TO authenticated
  USING (public.is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- ── 7. Assertions ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_target regprocedure;
  v_def text;
  n int;
BEGIN
  -- 7a. Columns present; pay_type pinned; no NULL pay_type left.
  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'employees'
    AND column_name IN ('home_address', 'emergency_contact_name',
                        'emergency_contact_phone', 'shirt_size',
                        'has_completed_self_onboarding', 'pay_type',
                        'annual_salary', 'date_of_birth', 'phone');
  IF n <> 9 THEN
    RAISE EXCEPTION 'ASSERTION 1 FAILED — expected 9 employee columns, found %', n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'employees_pay_type_check'
                   AND conrelid = 'public.employees'::regclass) THEN
    RAISE EXCEPTION 'ASSERTION 1 FAILED — employees_pay_type_check missing';
  END IF;
  IF EXISTS (SELECT 1 FROM employees WHERE pay_type IS NULL) THEN
    RAISE EXCEPTION 'ASSERTION 1 FAILED — NULL pay_type rows survived the backfill';
  END IF;

  -- 7b. employee_is_tipped is pay-type driven and position-free.
  v_def := pg_get_functiondef(to_regprocedure('public.employee_is_tipped(uuid)'));
  IF v_def NOT LIKE '%pay_type%' OR v_def LIKE '%is_tipped, true%'
     OR v_def LIKE '%outlet_roles%' THEN
    RAISE EXCEPTION 'ASSERTION 2 FAILED — employee_is_tipped still position-based';
  END IF;

  -- 7c. The engine guard is swapped (pay_type in, orl.is_tipped out).
  v_target := coalesce(to_regprocedure('public.ts_compute_unguarded(uuid)'),
                       to_regprocedure('public.ts_compute(uuid)'));
  v_def := pg_get_functiondef(v_target);
  IF v_def NOT LIKE '%emp.pay_type%' THEN
    RAISE EXCEPTION 'ASSERTION 3 FAILED — % missing the pay-type guard', v_target;
  END IF;
  IF v_def LIKE '%orl.is_tipped%' THEN
    RAISE EXCEPTION 'ASSERTION 3 FAILED — % still consults outlet_roles.is_tipped', v_target;
  END IF;

  -- 7d. RPCs exist; anon locked out of all three.
  IF to_regprocedure('public.employee_self_onboard(date, text, text, text, text, text)') IS NULL
     OR to_regprocedure('public.running_late_submit(int, uuid)') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION 4 FAILED — 019 RPCs missing';
  END IF;
  IF has_function_privilege('anon', 'public.employee_self_onboard(date, text, text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.running_late_submit(int, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.employee_is_tipped(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION 4 FAILED — anon can execute a 019 RPC';
  END IF;

  -- 7e. New tables RLS'd with the expected policies.
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
             WHERE ns.nspname = 'public' AND c.relname IN ('late_signals', 'eod_reports')
               AND NOT c.relrowsecurity) THEN
    RAISE EXCEPTION 'ASSERTION 5 FAILED — RLS not enabled on a new table';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
      AND ((tablename = 'late_signals' AND policyname IN ('manager_full_access', 'own_rows_select'))
        OR (tablename = 'eod_reports' AND policyname = 'manager_full_access'))) <> 3 THEN
    RAISE EXCEPTION 'ASSERTION 5 FAILED — new-table policies wrong';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run by hand after applying) ────────────────────────────
-- 1. Pay-type distribution + everyone flagged onboarded:
SELECT pay_type, count(*), count(*) FILTER (WHERE has_completed_self_onboarding) AS onboarded
FROM employees GROUP BY pay_type;
-- 2. Engine guard swapped (expect 1 row, and 0 rows mentioning orl.is_tipped):
SELECT proname FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
WHERE ns.nspname = 'public' AND proname IN ('ts_compute', 'ts_compute_unguarded')
  AND pg_get_functiondef(p.oid) LIKE '%emp.pay_type%';
-- 3. Helper responds (SQL editor has no JWT → false, no error):
SELECT public.employee_is_tipped();

-- ── Rollback (run by hand only) ──────────────────────────────────────────
-- Functions: re-apply 017_tipped_positions.sql sections 2–3 (they restore
-- the position-based employee_is_tipped and re-patch the engine — its
-- patch block skips only when 'orl.is_tipped' is present, so after this
-- rollback edit: first re-create the engine from
-- 019_tip_compute_case_insensitive.sql renamed to ts_compute_unguarded,
-- then run 017). Tables/columns: DROP TABLE late_signals, eod_reports;
-- the employees columns are additive and safe to leave.

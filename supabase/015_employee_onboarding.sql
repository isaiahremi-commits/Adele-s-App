-- =========================================================================
-- Migration 015 (Phase 2) — Employee onboarding (web admin flow).
-- Run in the Supabase SQL editor AFTER 014_hardening.sql. Idempotent
-- (IF NOT EXISTS / OR REPLACE / conditional guards); safe to re-run.
--
-- Companion to the web-app onboarding PR: the Next.js admin routes create
-- the auth.users record + employees row + employee_outlets rows with the
-- service-role key (SECURITY DEFINER RPCs cannot call the Supabase Auth
-- Admin API). This migration supplies everything the DATABASE must provide:
--
-- 1. employee_outlets TENANT SCOPING. The table exists in the live schema
--    (004b gave it a manager-only policy) but it was never added to 005's
--    _tenant_tables list — no tenant_id column, no tenant predicate in its
--    policy. Fixed here with the exact 005 treatment (column + backfill +
--    NOT NULL + DEFAULT current_tenant_id() + index + tenant-scoped
--    manager_full_access). 005 REV 4 adds it to the canonical list, so a
--    future 005 re-run keeps it consistent; both orders converge — 005's
--    loop and this section are each idempotent.
--
-- 2. AUTH-LINKAGE CONSTRAINT. One auth login maps to at most one employee
--    per tenant: partial unique index on (tenant_id, auth_user_id).
--    current_employee_id() (007) does `WHERE auth_user_id = auth.uid() AND
--    tenant_id = current_tenant_id() LIMIT 1` — a duplicate link would make
--    that LIMIT 1 nondeterministic, i.e. an employee could resolve to the
--    wrong person's rows. A pre-assertion lists any existing duplicates
--    before the index is attempted, so a dirty-data failure names the rows
--    instead of erroring opaquely.
--
-- 3. LIFECYCLE RPCs (all NEW functions — nothing existing is redefined):
--      employee_terminate(p_employee_id, p_termination_date default
--        tenant-local today) — stamps termination_date, deletes the
--        employee's device_sessions rows (client-side sign-out on next
--        foreground, the 006 posture). Returns auth_user_id so the web
--        route can ALSO ban the auth user via the Admin API (that is the
--        real server-side revocation; the RPC alone cannot do it).
--      employee_reactivate(p_employee_id) — clears termination_date (the
--        "oops, they came back" case). Returns auth_user_id so the route
--        can un-ban.
--      employee_reset_password_needed(p_employee_id) — re-arms the
--        must_change_password gate in auth.users.raw_user_meta_data. The
--        mobile app's AuthContext reads user_metadata.must_change_password
--        and forces ChangePasswordScreen. Writing auth.users from SQL works
--        because this function's owner (postgres, when applied via the
--        dashboard) holds UPDATE on auth.users in hosted Supabase.
--    All three are manager-only via assert_manager_or_service() (014),
--    called INLINE — the 014 rename+shim mechanism was for retrofitting
--    Phase 1 bodies without copying them; new functions simply start with
--    the guard. Ownership failures read as 'Employee not found' (no
--    cross-tenant existence leak).
-- =========================================================================

BEGIN;

-- ── 0. Fail-fast prerequisites ───────────────────────────────────────────
DO $do$
BEGIN
  IF to_regprocedure('public.current_tenant_id()') IS NULL
     OR to_regprocedure('public.is_restaurant_manager()') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — apply migration 005 first';
  END IF;
  IF to_regprocedure('public.assert_manager_or_service()') IS NULL
     OR to_regprocedure('public.tenant_today()') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — apply migration 014 first';
  END IF;
  IF to_regclass('public.device_sessions') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — apply migration 006 first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employees'
      AND column_name = 'auth_user_id'
  ) THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — employees.auth_user_id missing';
  END IF;
END $do$;

-- ── 1. employee_outlets: ensure it exists, then tenant-scope it ──────────
-- The live table predates tenancy; CREATE IF NOT EXISTS covers a fresh
-- environment. Shape mirrors shared/db.types.ts (nullable FKs, no ON DELETE
-- assumptions beyond what a fresh create should have).
CREATE TABLE IF NOT EXISTS employee_outlets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  outlet_id uuid REFERENCES outlets(id) ON DELETE CASCADE,
  position_name text
);

ALTER TABLE employee_outlets
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);

-- Backfill from the linked employee's tenant; orphan rows (nullable
-- employee_id) fall back to the pilot tenant, same constant 005 used.
UPDATE employee_outlets eo
SET tenant_id = e.tenant_id
FROM employees e
WHERE eo.employee_id = e.id AND eo.tenant_id IS NULL;

UPDATE employee_outlets
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

ALTER TABLE employee_outlets ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE employee_outlets
  ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS employee_outlets_tenant_id_idx
  ON employee_outlets (tenant_id);
-- The web routes filter by employee_id on every edit-modal open.
CREATE INDEX IF NOT EXISTS employee_outlets_employee_id_idx
  ON employee_outlets (employee_id);

ALTER TABLE employee_outlets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON employee_outlets;
CREATE POLICY manager_full_access ON employee_outlets FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- ── 2. employees: one auth login ↔ one employee per tenant ───────────────
-- Pre-assertion so dirty data fails with names, not a bare unique error.
DO $do$
DECLARE dupes text;
BEGIN
  SELECT string_agg(auth_user_id::text || ' ×' || n, ', ') INTO dupes
  FROM (
    SELECT auth_user_id, count(*) AS n
    FROM employees
    WHERE auth_user_id IS NOT NULL
    GROUP BY tenant_id, auth_user_id
    HAVING count(*) > 1
  ) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — employees sharing an auth login '
      'within a tenant: %. Unlink the duplicates (SET auth_user_id = NULL '
      'on the wrong rows), then re-run.', dupes;
  END IF;
END $do$;

CREATE UNIQUE INDEX IF NOT EXISTS employees_tenant_auth_user_uniq
  ON employees (tenant_id, auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- ── 3. employee_terminate ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.employee_terminate(
  p_employee_id uuid,
  p_termination_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
  v_term date;
  v_kicked int := 0;
BEGIN
  PERFORM public.assert_manager_or_service();

  SELECT e.* INTO v_emp FROM employees e
  WHERE e.id = p_employee_id AND e.tenant_id = public.current_tenant_id()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  -- Default: today in the tenant's timezone (014), not UTC's idea of today.
  v_term := coalesce(p_termination_date, public.tenant_today());
  IF v_emp.date_of_hire IS NOT NULL AND v_term < v_emp.date_of_hire THEN
    RAISE EXCEPTION 'Termination date cannot be before the hire date';
  END IF;

  -- Re-terminating just moves the date — managers correct mistakes.
  UPDATE employees SET termination_date = v_term WHERE id = v_emp.id;

  IF v_emp.auth_user_id IS NOT NULL THEN
    DELETE FROM device_sessions WHERE user_id = v_emp.auth_user_id;
    GET DIAGNOSTICS v_kicked = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'termination_date', v_term,
    'auth_user_id', v_emp.auth_user_id,
    'device_sessions_revoked', v_kicked
  );
END;
$$;

REVOKE ALL ON FUNCTION employee_terminate(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION employee_terminate(uuid, date) TO authenticated;

-- ── 4. employee_reactivate ───────────────────────────────────────────────
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

  RETURN jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'auth_user_id', v_emp.auth_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION employee_reactivate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION employee_reactivate(uuid) TO authenticated;

-- ── 5. employee_reset_password_needed ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.employee_reset_password_needed(
  p_employee_id uuid
)
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
  WHERE e.id = p_employee_id AND e.tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;
  IF v_emp.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Employee has no linked login yet';
  END IF;

  UPDATE auth.users
  SET raw_user_meta_data =
        coalesce(raw_user_meta_data, '{}'::jsonb)
        || jsonb_build_object('must_change_password', true),
      updated_at = now()
  WHERE id = v_emp.auth_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linked login no longer exists';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'auth_user_id', v_emp.auth_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION employee_reset_password_needed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION employee_reset_password_needed(uuid) TO authenticated;

-- ── 6. Assertions (inside the transaction — abort before COMMIT) ─────────
DO $do$
DECLARE
  v_qual text;
  f text;
  v_def text;
BEGIN
  -- 6a. employee_outlets is tenant-scoped: NOT NULL column + tenant policy.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employee_outlets'
      AND column_name = 'tenant_id' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED — employee_outlets.tenant_id not NOT NULL';
  END IF;
  SELECT pg_get_expr(polqual, polrelid) INTO v_qual
  FROM pg_policy
  WHERE polrelid = 'public.employee_outlets'::regclass
    AND polname = 'manager_full_access';
  IF v_qual IS NULL OR v_qual NOT LIKE '%current_tenant_id%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED — employee_outlets policy not tenant-scoped: %',
      coalesce(v_qual, '<missing>');
  END IF;

  -- 6b. Unique auth linkage index exists and is partial + unique.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'employees'
      AND indexname = 'employees_tenant_auth_user_uniq'
      AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%auth_user_id IS NOT NULL%'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED — employees_tenant_auth_user_uniq missing or wrong shape';
  END IF;

  -- 6c. Every new RPC exists, is guarded, and anon cannot execute it.
  FOREACH f IN ARRAY ARRAY[
    'employee_terminate(uuid, date)',
    'employee_reactivate(uuid)',
    'employee_reset_password_needed(uuid)'
  ] LOOP
    IF to_regprocedure('public.' || f) IS NULL THEN
      RAISE EXCEPTION 'ASSERTION FAILED — % missing', f;
    END IF;
    v_def := pg_get_functiondef(to_regprocedure('public.' || f));
    IF v_def NOT LIKE '%assert_manager_or_service%' THEN
      RAISE EXCEPTION 'ASSERTION FAILED — % is not guarded', f;
    END IF;
    IF has_function_privilege('anon', to_regprocedure('public.' || f), 'EXECUTE') THEN
      RAISE EXCEPTION 'ASSERTION FAILED — anon can execute %', f;
    END IF;
  END LOOP;
END $do$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run after COMMIT; read-only) ───────────────────────────
-- 1. employee_outlets tenant plumbing — expect tenant_id | NO, one
--    tenant-scoped policy row:
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'employee_outlets'
  AND column_name = 'tenant_id';
SELECT polname, pg_get_expr(polqual, polrelid) AS qual
FROM pg_policy WHERE polrelid = 'public.employee_outlets'::regclass;
-- 2. No employee_outlets row without a tenant — MUST return 0:
SELECT count(*) FROM employee_outlets WHERE tenant_id IS NULL;
-- 3. Auth-linkage uniqueness — expect one UNIQUE partial index:
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'employees' AND indexname = 'employees_tenant_auth_user_uniq';
-- 4. The three RPCs, guarded (all rows must show guarded = true):
SELECT p.proname,
       pg_get_functiondef(p.oid) LIKE '%assert_manager_or_service%' AS guarded,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_exec  -- false
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f'
  AND p.proname IN ('employee_terminate', 'employee_reactivate',
                    'employee_reset_password_needed');
-- 5. Negative smoke test from the SQL editor (no JWT → not a manager):
--    SELECT employee_terminate('00000000-0000-0000-0000-000000000000');
--    must raise 'Managers only'. That raise IS the passing result here.

-- ── Rollback (run by hand only) ──────────────────────────────────────────
-- BEGIN;
-- DROP FUNCTION IF EXISTS employee_terminate(uuid, date);
-- DROP FUNCTION IF EXISTS employee_reactivate(uuid);
-- DROP FUNCTION IF EXISTS employee_reset_password_needed(uuid);
-- DROP INDEX IF EXISTS employees_tenant_auth_user_uniq;
-- -- employee_outlets tenant_id/policy left in place deliberately (data-
-- -- bearing; reverting tenancy is never the right move once stamped).
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';

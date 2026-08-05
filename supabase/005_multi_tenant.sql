-- =========================================================================
-- Migration 005 (Phase 2) — Multi-tenant hardening.
-- Run in the Supabase SQL editor. Idempotent (IF NOT EXISTS / OR REPLACE /
-- ON CONFLICT guards); safe to re-run. One transaction — all or nothing.
--
-- NOTE ON NUMBERING: Phase 1 already has 005_normalize_tip_sheets_casing.sql
-- and 006_seed_adele_pto_balance.sql in this folder. This file and
-- 006_device_sessions.sql restart the Phase 2 sequence per the PR #3 spec —
-- filenames don't collide and migrations are applied by hand, so the overlap
-- is cosmetic only.
--
-- What this does:
--   1. Creates `tenants` and seeds the Adele Pilot tenant.
--   2. Adds `tenant_id` to the 19 operational tables below, backfills every
--      existing row to Adele Pilot, then sets NOT NULL + an index per table.
--   3. Creates `public.current_tenant_id()` reading the JWT's
--      user_metadata.tenant_id claim.
--      ── The PR spec asked for `auth.current_tenant_id()`, but Supabase
--      manages the `auth` schema and revoked CREATE on it from the `postgres`
--      role (dashboard SQL editor runs as `postgres`), so creating a function
--      there fails with "permission denied for schema auth" on current
--      projects. Same semantics, `public` schema instead.
--   4. Rewrites the 004b `manager_full_access` policy on each tenant-scoped
--      table to require `tenant_id = public.current_tenant_id()` in addition
--      to the manager check, and tenant-scopes `is_restaurant_manager()`
--      itself so a manager row in tenant A can never unlock tenant B's data.
--   5. Adds DEFAULT public.current_tenant_id() on every tenant_id column so
--      existing app INSERTs (which never mention tenant_id) keep working —
--      rows are auto-stamped with the caller's tenant. SQL-editor /
--      service-role inserts have no JWT, so they must set tenant_id
--      explicitly.
--
-- Tables intentionally left tenant-agnostic (global reference/support data,
-- policies unchanged from 004b): departments, employee_outlets,
-- outlet_services, payroll_periods, services, sms_log, sms_settings,
-- tip_allocations. Revisit if any of these become tenant-specific.
--
-- =========================================================================
-- user_metadata.tenant_id — MANUAL STEPS (Isaiah), do these WITH this
-- migration, not later:
--
--   For the pilot, stamp the tenant onto Adele + existing test users:
--
--     UPDATE auth.users
--        SET raw_user_meta_data = raw_user_meta_data
--            || '{"tenant_id": "00000000-0000-0000-0000-000000000001"}'::jsonb
--      WHERE email IN ('adele@example.com', 'isaiah.remi@yopmail.com');  -- edit list
--
--   ORDERING MATTERS: once this migration runs, a JWT without a tenant_id
--   claim makes current_tenant_id() return NULL, every policy predicate
--   fails, and the user sees no data (the mobile app shows a "No tenant
--   assigned" screen). The claim only enters the JWT when a token is minted,
--   so after stamping, users must sign out/in (or wait for the next token
--   refresh) to pick it up. Apply migration + stamp in the same sitting.
--
--   A future PR adds a server-side invite flow that stamps tenant_id at user
--   creation; this manual UPDATE is pilot-only scaffolding.
-- =========================================================================

BEGIN;

-- ── 1. Tenants ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

INSERT INTO tenants (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Adele Pilot', 'adele-pilot')
ON CONFLICT (id) DO NOTHING;

-- ── 2. Tenant helper ─────────────────────────────────────────────────────

-- Reads the caller's tenant from the JWT's user_metadata claim. NULL when the
-- claim is absent (no JWT, or user not yet stamped) — which fails every
-- tenant predicate closed. STABLE = evaluated once per query.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() -> 'user_metadata' ->> 'tenant_id', '')::uuid;
$$;

-- Tenant-scoped rewrite of the 004b helper: the manager row must belong to
-- the caller's own tenant. Same SECURITY DEFINER / STABLE / search_path
-- rationale as 004b (bypasses RLS on employees without recursing).
CREATE OR REPLACE FUNCTION is_restaurant_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees
    WHERE auth_user_id = auth.uid()
      AND title = 'Restaurant Manager'
      AND tenant_id = public.current_tenant_id()
  );
$$;

-- tenants itself: members may read their own tenant row; nobody writes via
-- the API (service role / SQL editor only).
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS member_read_own_tenant ON tenants;
CREATE POLICY member_read_own_tenant ON tenants FOR SELECT TO authenticated
  USING (id = public.current_tenant_id());

-- ── 3. Per-table block: column + backfill + NOT NULL + index + policy ────
-- Uniform for all 19 operational tables. The employees block MUST run before
-- is_restaurant_manager() is next evaluated with the new predicate — inside
-- this transaction that's guaranteed.

-- employees
ALTER TABLE employees ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE employees SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE employees ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE employees ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS employees_tenant_id_idx ON employees (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON employees;
CREATE POLICY manager_full_access ON employees FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- outlets
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE outlets SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE outlets ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE outlets ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS outlets_tenant_id_idx ON outlets (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON outlets;
CREATE POLICY manager_full_access ON outlets FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- shifts
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE shifts SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE shifts ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE shifts ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS shifts_tenant_id_idx ON shifts (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON shifts;
CREATE POLICY manager_full_access ON shifts FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- timecards
ALTER TABLE timecards ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE timecards SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE timecards ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE timecards ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS timecards_tenant_id_idx ON timecards (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON timecards;
CREATE POLICY manager_full_access ON timecards FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- tip_sheets
ALTER TABLE tip_sheets ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE tip_sheets SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE tip_sheets ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE tip_sheets ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS tip_sheets_tenant_id_idx ON tip_sheets (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON tip_sheets;
CREATE POLICY manager_full_access ON tip_sheets FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- tip_sheet_rows
ALTER TABLE tip_sheet_rows ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE tip_sheet_rows SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE tip_sheet_rows ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE tip_sheet_rows ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS tip_sheet_rows_tenant_id_idx ON tip_sheet_rows (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON tip_sheet_rows;
CREATE POLICY manager_full_access ON tip_sheet_rows FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- pto_requests
ALTER TABLE pto_requests ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE pto_requests SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE pto_requests ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE pto_requests ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS pto_requests_tenant_id_idx ON pto_requests (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON pto_requests;
CREATE POLICY manager_full_access ON pto_requests FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- pto_allocations
ALTER TABLE pto_allocations ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE pto_allocations SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE pto_allocations ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE pto_allocations ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS pto_allocations_tenant_id_idx ON pto_allocations (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON pto_allocations;
CREATE POLICY manager_full_access ON pto_allocations FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- pto_balances
ALTER TABLE pto_balances ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE pto_balances SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE pto_balances ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE pto_balances ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS pto_balances_tenant_id_idx ON pto_balances (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON pto_balances;
CREATE POLICY manager_full_access ON pto_balances FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- pto_balance_transactions
ALTER TABLE pto_balance_transactions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE pto_balance_transactions SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE pto_balance_transactions ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE pto_balance_transactions ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS pto_balance_transactions_tenant_id_idx ON pto_balance_transactions (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON pto_balance_transactions;
CREATE POLICY manager_full_access ON pto_balance_transactions FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- callout_history
ALTER TABLE callout_history ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE callout_history SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE callout_history ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE callout_history ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS callout_history_tenant_id_idx ON callout_history (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON callout_history;
CREATE POLICY manager_full_access ON callout_history FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- lateness_history
ALTER TABLE lateness_history ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE lateness_history SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE lateness_history ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE lateness_history ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS lateness_history_tenant_id_idx ON lateness_history (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON lateness_history;
CREATE POLICY manager_full_access ON lateness_history FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- swap_history
ALTER TABLE swap_history ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE swap_history SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE swap_history ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE swap_history ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS swap_history_tenant_id_idx ON swap_history (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON swap_history;
CREATE POLICY manager_full_access ON swap_history FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- large_party_revenues
ALTER TABLE large_party_revenues ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE large_party_revenues SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE large_party_revenues ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE large_party_revenues ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS large_party_revenues_tenant_id_idx ON large_party_revenues (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON large_party_revenues;
CREATE POLICY manager_full_access ON large_party_revenues FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- outlet_roles
ALTER TABLE outlet_roles ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE outlet_roles SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE outlet_roles ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE outlet_roles ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS outlet_roles_tenant_id_idx ON outlet_roles (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON outlet_roles;
CREATE POLICY manager_full_access ON outlet_roles FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- tip_pools
ALTER TABLE tip_pools ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE tip_pools SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE tip_pools ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE tip_pools ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS tip_pools_tenant_id_idx ON tip_pools (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON tip_pools;
CREATE POLICY manager_full_access ON tip_pools FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- setup
ALTER TABLE setup ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE setup SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE setup ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE setup ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS setup_tenant_id_idx ON setup (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON setup;
CREATE POLICY manager_full_access ON setup FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- timecard_events
ALTER TABLE timecard_events ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE timecard_events SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE timecard_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE timecard_events ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS timecard_events_tenant_id_idx ON timecard_events (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON timecard_events;
CREATE POLICY manager_full_access ON timecard_events FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- approved_weeks
ALTER TABLE approved_weeks ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE approved_weeks SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE approved_weeks ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE approved_weeks ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS approved_weeks_tenant_id_idx ON approved_weeks (tenant_id);
DROP POLICY IF EXISTS manager_full_access ON approved_weeks;
CREATE POLICY manager_full_access ON approved_weeks FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification ─────────────────────────────────────────────────────────
-- Every row must show without_tenant = 0. Run as-is after the COMMIT.
SELECT 'approved_weeks' AS tbl, count(*) AS total, count(tenant_id) AS with_tenant, count(*) - count(tenant_id) AS without_tenant FROM approved_weeks
UNION ALL SELECT 'callout_history', count(*), count(tenant_id), count(*) - count(tenant_id) FROM callout_history
UNION ALL SELECT 'employees', count(*), count(tenant_id), count(*) - count(tenant_id) FROM employees
UNION ALL SELECT 'large_party_revenues', count(*), count(tenant_id), count(*) - count(tenant_id) FROM large_party_revenues
UNION ALL SELECT 'lateness_history', count(*), count(tenant_id), count(*) - count(tenant_id) FROM lateness_history
UNION ALL SELECT 'outlet_roles', count(*), count(tenant_id), count(*) - count(tenant_id) FROM outlet_roles
UNION ALL SELECT 'outlets', count(*), count(tenant_id), count(*) - count(tenant_id) FROM outlets
UNION ALL SELECT 'pto_allocations', count(*), count(tenant_id), count(*) - count(tenant_id) FROM pto_allocations
UNION ALL SELECT 'pto_balance_transactions', count(*), count(tenant_id), count(*) - count(tenant_id) FROM pto_balance_transactions
UNION ALL SELECT 'pto_balances', count(*), count(tenant_id), count(*) - count(tenant_id) FROM pto_balances
UNION ALL SELECT 'pto_requests', count(*), count(tenant_id), count(*) - count(tenant_id) FROM pto_requests
UNION ALL SELECT 'setup', count(*), count(tenant_id), count(*) - count(tenant_id) FROM setup
UNION ALL SELECT 'shifts', count(*), count(tenant_id), count(*) - count(tenant_id) FROM shifts
UNION ALL SELECT 'swap_history', count(*), count(tenant_id), count(*) - count(tenant_id) FROM swap_history
UNION ALL SELECT 'timecard_events', count(*), count(tenant_id), count(*) - count(tenant_id) FROM timecard_events
UNION ALL SELECT 'timecards', count(*), count(tenant_id), count(*) - count(tenant_id) FROM timecards
UNION ALL SELECT 'tip_pools', count(*), count(tenant_id), count(*) - count(tenant_id) FROM tip_pools
UNION ALL SELECT 'tip_sheet_rows', count(*), count(tenant_id), count(*) - count(tenant_id) FROM tip_sheet_rows
UNION ALL SELECT 'tip_sheets', count(*), count(tenant_id), count(*) - count(tenant_id) FROM tip_sheets
ORDER BY 1;

-- ── Rollback (run by hand only — restores the 004b posture) ──────────────
-- BEGIN;
-- CREATE OR REPLACE FUNCTION is_restaurant_manager()
-- RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
-- AS $$
--   SELECT EXISTS (
--     SELECT 1 FROM employees
--     WHERE auth_user_id = auth.uid() AND title = 'Restaurant Manager'
--   );
-- $$;
-- DO $$
-- DECLARE t text;
-- BEGIN
--   FOREACH t IN ARRAY ARRAY[
--     'approved_weeks','callout_history','employees','large_party_revenues',
--     'lateness_history','outlet_roles','outlets','pto_allocations',
--     'pto_balance_transactions','pto_balances','pto_requests','setup',
--     'shifts','swap_history','timecard_events','timecards','tip_pools',
--     'tip_sheet_rows','tip_sheets'
--   ] LOOP
--     EXECUTE format('DROP POLICY IF EXISTS manager_full_access ON %I', t);
--     EXECUTE format(
--       'CREATE POLICY manager_full_access ON %I FOR ALL TO authenticated
--          USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager())', t);
--     EXECUTE format('DROP INDEX IF EXISTS %I', t || '_tenant_id_idx');
--     EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS tenant_id', t);
--   END LOOP;
-- END $$;
-- DROP POLICY IF EXISTS member_read_own_tenant ON tenants;
-- DROP TABLE IF EXISTS tenants;
-- DROP FUNCTION IF EXISTS public.current_tenant_id();
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';

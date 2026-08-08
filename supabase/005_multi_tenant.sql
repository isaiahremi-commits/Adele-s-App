-- =========================================================================
-- Migration 005 (Phase 2) — Multi-tenant hardening.  REV 3.
--
-- REV 3 (PR #12): the Phase 2 tables that arrived after this migration —
-- coverage_requests (010), broadcasts / broadcast_reads / broadcast_replies
-- (013) — are now in _tenant_tables, so a re-run of this file no longer
-- trips assertion 3 on them. They were born tenant-scoped; on a re-run the
-- column/backfill loop no-ops and the policy rewrite recreates the same
-- manager_full_access shape they already carry. Because this file runs
-- BEFORE 010/013 on a fresh database, every loop and assertion now skips
-- (with a NOTICE) listed tables that don't exist yet — they're picked up
-- the next time this file runs after they're created.
-- Run in the Supabase SQL editor. Idempotent (IF NOT EXISTS / OR REPLACE /
-- ON CONFLICT guards); safe to re-run. One transaction — all or nothing: a
-- failure at any point (including inside the DO blocks' dynamic SQL) rolls
-- the whole migration back and leaves the database untouched.
--
-- REV 2 post-mortem: rev 1 failed at apply time with `column "tenant_id"
-- does not exist` — the is_restaurant_manager() rewrite referenced
-- employees.tenant_id, and Postgres validates LANGUAGE sql function bodies
-- at CREATE time, but the employees ADD COLUMN sat later in the file. Fixed
-- by strict phase ordering (columns first, function + policies after) and by
-- driving every per-table statement from ONE canonical list (_tenant_tables)
-- so the column list and the policy list can never diverge. Assertion blocks
-- fail fast between phases:
--   assertion 1 (before any policy work): every listed table has tenant_id;
--   assertion 2 (after): every listed table's policy is tenant-scoped;
--   assertion 3 (after): no unlisted table has a tenant_id column (a column
--     without a rewritten policy would silently serve cross-tenant rows).
-- The assertions sit mid-file, not at the very top, out of necessity: on a
-- first run the columns don't exist until phase 2 creates them. They run at
-- the earliest point each can hold.
--
-- NOTE ON NUMBERING: Phase 1 already has 005_normalize_tip_sheets_casing.sql
-- and 006_seed_adele_pto_balance.sql in this folder. This file and
-- 006_device_sessions.sql restart the Phase 2 sequence per the PR #3 spec —
-- filenames don't collide and migrations are applied by hand, so the overlap
-- is cosmetic only.
--
-- What this does:
--   1. Creates `tenants` and seeds the Adele Pilot tenant.
--   2. Adds `tenant_id` to the 19 operational tables in _tenant_tables,
--      backfills every existing row to Adele Pilot, then sets NOT NULL +
--      DEFAULT + an index per table.
--   3. Creates `public.current_tenant_id()` reading the JWT's
--      user_metadata.tenant_id claim.
--      ── The PR spec asked for `auth.current_tenant_id()`, but Supabase
--      manages the `auth` schema and revoked CREATE on it from the `postgres`
--      role (dashboard SQL editor runs as `postgres`), so creating a function
--      there fails with "permission denied for schema auth" on current
--      projects. Same semantics, `public` schema instead.
--   4. Rewrites the 004b `manager_full_access` policy on each listed table
--      to require `tenant_id = public.current_tenant_id()` in addition to
--      the manager check, and tenant-scopes `is_restaurant_manager()` itself
--      so a manager row in tenant A can never unlock tenant B's data.
--   5. DEFAULT public.current_tenant_id() on every tenant_id column means
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

-- ── Phase 0: canonical table list — THE single source of truth ───────────
-- Every phase below (columns, assertions, policies, audits) reads this list.
-- To tenant-scope another table later, add it here and re-run the migration.
CREATE TEMP TABLE _tenant_tables (name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _tenant_tables (name) VALUES
  ('approved_weeks'),
  ('broadcast_reads'),      -- REV 3 (013)
  ('broadcast_replies'),    -- REV 3 (013)
  ('broadcasts'),           -- REV 3 (013)
  ('callout_history'),
  ('coverage_requests'),    -- REV 3 (010)
  ('employees'),
  ('large_party_revenues'),
  ('lateness_history'),
  ('outlet_roles'),
  ('outlets'),
  ('pto_allocations'),
  ('pto_balance_transactions'),
  ('pto_balances'),
  ('pto_requests'),
  ('setup'),
  ('shifts'),
  ('swap_history'),
  ('timecard_events'),
  ('timecards'),
  ('tip_pools'),
  ('tip_sheet_rows'),
  ('tip_sheets');

-- ── Phase 1: tenants table + seed + tenant helper ────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

INSERT INTO tenants (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Adele Pilot', 'adele-pilot')
ON CONFLICT (id) DO NOTHING;

-- Reads the caller's tenant from the JWT's user_metadata claim. NULL when the
-- claim is absent (no JWT, or user not yet stamped) — which fails every
-- tenant predicate closed. STABLE = evaluated once per query. References no
-- tables, so it is safe to create before the columns exist.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() -> 'user_metadata' ->> 'tenant_id', '')::uuid;
$$;

-- ── Phase 2: tenant_id column + backfill + NOT NULL + DEFAULT + index ────
-- Column work ONLY — nothing here may reference tenant_id in SQL that
-- Postgres validates at definition time. Dynamic SQL in a DO block is only
-- validated at EXECUTE, and by then the column exists.

DO $$
DECLARE t text;
BEGIN
  -- REV 3: skip listed tables that don't exist yet (fresh DB runs this
  -- before 010/013 create theirs).
  FOR t IN SELECT name FROM _tenant_tables
           WHERE to_regclass('public.' || name) IS NULL LOOP
    RAISE NOTICE 'skipping % — not created yet (apply its migration, then re-run 005 if desired)', t;
  END LOOP;
  FOR t IN SELECT name FROM _tenant_tables
           WHERE to_regclass('public.' || name) IS NOT NULL ORDER BY name LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id)', t);
    EXECUTE format(
      'UPDATE %I SET tenant_id = %L WHERE tenant_id IS NULL',
      t, '00000000-0000-0000-0000-000000000001');
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL', t);
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id()', t);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (tenant_id)', t || '_tenant_id_idx', t);
  END LOOP;
END $$;

-- ── Assertion 1: every listed table now has tenant_id ────────────────────
-- Fails fast BEFORE any function/policy references the column. Catches a
-- typo'd or missing table while the transaction can still roll back cleanly.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(t.name, ', ' ORDER BY t.name) INTO missing
  FROM _tenant_tables t
  WHERE to_regclass('public.' || t.name) IS NOT NULL  -- REV 3: absent = skipped
    AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = t.name
      AND c.column_name = 'tenant_id'
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION 1 FAILED — tenant_id missing on: %. '
      'The policy rewrites below would fail; aborting.', missing;
  END IF;
END $$;

-- ── Phase 3: tenant-scoped functions + policies ──────────────────────────
-- Only past this line may SQL reference tenant_id at definition time.

-- Tenant-scoped rewrite of the 004b helper: the manager row must belong to
-- the caller's own tenant. Same SECURITY DEFINER / STABLE / search_path
-- rationale as 004b (bypasses RLS on employees without recursing). MUST come
-- after phase 2 — LANGUAGE sql bodies are validated at CREATE time, and this
-- one reads employees.tenant_id (the rev 1 failure).
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

-- Rewrite manager_full_access on every listed table: manager check AND
-- tenant match. Driven by the same _tenant_tables list as phase 2, so the
-- column list and policy list cannot diverge.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT name FROM _tenant_tables
           WHERE to_regclass('public.' || name) IS NOT NULL ORDER BY name LOOP
    EXECUTE format('DROP POLICY IF EXISTS manager_full_access ON %I', t);
    EXECUTE format(
      'CREATE POLICY manager_full_access ON %I FOR ALL TO authenticated
         USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
         WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id())', t);
  END LOOP;
END $$;

-- ── Assertion 2: every listed table's policy is tenant-scoped ────────────
-- A listed table whose manager_full_access predicate lacks
-- current_tenant_id() would serve cross-tenant rows to any manager.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(t.name, ', ' ORDER BY t.name) INTO bad
  FROM _tenant_tables t
  WHERE to_regclass('public.' || t.name) IS NOT NULL  -- REV 3: absent = skipped
    AND NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = t.name
      AND p.policyname = 'manager_full_access'
      AND p.qual LIKE '%current_tenant_id%'
      AND p.with_check LIKE '%current_tenant_id%'
  );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION 2 FAILED — manager_full_access not '
      'tenant-scoped on: %. Cross-tenant leak; aborting.', bad;
  END IF;
END $$;

-- ── Assertion 3: no unlisted public table carries a tenant_id column ─────
-- The reverse audit: a tenant_id column on a table outside _tenant_tables
-- means its policies were never rewritten — silent cross-tenant leak.
DO $$
DECLARE stray text;
BEGIN
  SELECT string_agg(c.table_name, ', ' ORDER BY c.table_name) INTO stray
  FROM information_schema.columns c
  JOIN information_schema.tables tb
    ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
   AND tb.table_type = 'BASE TABLE'
  WHERE c.table_schema = 'public'
    AND c.column_name = 'tenant_id'
    AND c.table_name NOT IN (SELECT name FROM _tenant_tables);
  IF stray IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION 3 FAILED — tenant_id exists on unlisted '
      'table(s): %. Add them to _tenant_tables so their policies get '
      'rewritten; aborting.', stray;
  END IF;
END $$;

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

-- Policy spot-check: all 19 rows must show a qual containing
-- current_tenant_id.
SELECT tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public' AND policyname = 'manager_full_access'
  AND qual LIKE '%current_tenant_id%'
ORDER BY tablename;

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

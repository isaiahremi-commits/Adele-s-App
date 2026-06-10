-- =========================================================================
-- Migration 004b — Posture flip: RLS on every public table.
-- Run in the Supabase SQL editor. Idempotent (OR REPLACE / IF EXISTS / IF NOT
-- EXISTS-style guards). One transaction — all or nothing.
--
-- Enables RLS on every public-schema BASE TABLE and applies one uniform policy
-- (`manager_full_access`) gated on is_restaurant_manager(). Authenticated
-- callers linked to a Restaurant Manager employee row get full access;
-- everyone else (incl. anon) gets nothing. Phase 1 is single-user — no
-- per-employee/per-row policies.
--
-- Discovery (the authoritative list — run this yourself to confirm coverage):
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name;
-- The 26 tables below were enumerated by probing every table built across
-- Migrations 001–004a (event_managers/tip_event_managers were dropped in 003).
-- =========================================================================

BEGIN;

-- Helper: SECURITY DEFINER bypasses RLS while the policy checks the employees
-- table, so the policy on `employees` doesn't recurse. STABLE = cacheable
-- within a query. search_path pinned for safety.
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
  );
$$;

-- Uniform per-table block: enable RLS, (re)create the manager-only policy.
ALTER TABLE callout_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON callout_history;
CREATE POLICY manager_full_access ON callout_history FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON departments;
CREATE POLICY manager_full_access ON departments FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE employee_outlets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON employee_outlets;
CREATE POLICY manager_full_access ON employee_outlets FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON employees;
CREATE POLICY manager_full_access ON employees FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE large_party_revenues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON large_party_revenues;
CREATE POLICY manager_full_access ON large_party_revenues FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE lateness_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON lateness_history;
CREATE POLICY manager_full_access ON lateness_history FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE outlet_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON outlet_roles;
CREATE POLICY manager_full_access ON outlet_roles FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE outlet_services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON outlet_services;
CREATE POLICY manager_full_access ON outlet_services FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE outlets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON outlets;
CREATE POLICY manager_full_access ON outlets FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON payroll_periods;
CREATE POLICY manager_full_access ON payroll_periods FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE pto_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON pto_allocations;
CREATE POLICY manager_full_access ON pto_allocations FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE pto_balance_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON pto_balance_transactions;
CREATE POLICY manager_full_access ON pto_balance_transactions FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE pto_balances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON pto_balances;
CREATE POLICY manager_full_access ON pto_balances FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE pto_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON pto_requests;
CREATE POLICY manager_full_access ON pto_requests FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON services;
CREATE POLICY manager_full_access ON services FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE setup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON setup;
CREATE POLICY manager_full_access ON setup FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON shifts;
CREATE POLICY manager_full_access ON shifts FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE sms_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON sms_log;
CREATE POLICY manager_full_access ON sms_log FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE sms_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON sms_settings;
CREATE POLICY manager_full_access ON sms_settings FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE swap_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON swap_history;
CREATE POLICY manager_full_access ON swap_history FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE timecard_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON timecard_events;
CREATE POLICY manager_full_access ON timecard_events FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE timecards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON timecards;
CREATE POLICY manager_full_access ON timecards FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE tip_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON tip_allocations;
CREATE POLICY manager_full_access ON tip_allocations FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE tip_pools ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON tip_pools;
CREATE POLICY manager_full_access ON tip_pools FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE tip_sheet_rows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON tip_sheet_rows;
CREATE POLICY manager_full_access ON tip_sheet_rows FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

ALTER TABLE tip_sheets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON tip_sheets;
CREATE POLICY manager_full_access ON tip_sheets FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Completeness check — MUST return 0 rows. Any public table still showing here
-- was missed by the explicit blocks above and needs its own block.
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false;

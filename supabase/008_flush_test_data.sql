-- Migration 008 — flush all demo/test data for pilot.
-- Leaves a bare-metal DB: only Adèle's employees row, her pto_balances row, and
-- the setup row (defaults preserved). Schema unchanged. One transaction —
-- rolls back entirely on any error. Run in the Supabase SQL editor.
--
-- Most child tables ON DELETE CASCADE from their parents (Migration 001), but
-- every delete is explicit for auditability. services + payroll_periods are
-- included (demo rows the original spec list omitted — flushed per decision).
-- Does NOT touch: setup, Adèle's employees/pto_balances rows, auth.users.

BEGIN;

-- Operational data (leaf tables first).
DELETE FROM timecard_events;
DELETE FROM timecards;
DELETE FROM lateness_history;
DELETE FROM callout_history;
DELETE FROM swap_history;
DELETE FROM pto_balance_transactions;
DELETE FROM pto_allocations;
DELETE FROM pto_requests;
DELETE FROM large_party_revenues;
DELETE FROM tip_sheet_rows;
DELETE FROM tip_sheets;
DELETE FROM shifts;
DELETE FROM employee_outlets;
DELETE FROM payroll_periods;

-- Config / demo setup (Adèle reconfigures fresh).
DELETE FROM tip_pools;
DELETE FROM outlet_roles;
DELETE FROM services;
DELETE FROM outlet_services;
DELETE FROM outlets;
DELETE FROM departments;

-- PTO balances — keep only Adèle's.
DELETE FROM pto_balances
WHERE employee_id NOT IN (
  SELECT id FROM employees WHERE first_name = 'Adèle' AND last_name = 'Chappuis'
);

-- Employees — keep only Adèle.
DELETE FROM employees
WHERE NOT (first_name = 'Adèle' AND last_name = 'Chappuis');

-- setup row preserved with current defaults — intentionally not touched.

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify (expect: employees 1, pto_balances 1, setup 1, everything else 0):
-- SELECT 'employees' t, count(*) FROM employees
-- UNION ALL SELECT 'pto_balances', count(*) FROM pto_balances
-- UNION ALL SELECT 'shifts', count(*) FROM shifts
-- UNION ALL SELECT 'tip_sheets', count(*) FROM tip_sheets
-- UNION ALL SELECT 'outlets', count(*) FROM outlets
-- UNION ALL SELECT 'departments', count(*) FROM departments
-- UNION ALL SELECT 'services', count(*) FROM services
-- UNION ALL SELECT 'payroll_periods', count(*) FROM payroll_periods
-- UNION ALL SELECT 'setup', count(*) FROM setup;

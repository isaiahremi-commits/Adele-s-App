-- Migration 008 — flush all demo/test data for pilot.
-- Leaves a bare-metal DB: only Adèle's employees row, her pto_balances row, and
-- the setup row (defaults preserved). Schema unchanged. One transaction —
-- rolls back entirely on any error. Run in the Supabase SQL editor.
--
-- FK ordering note: employees.home_outlet_id -> outlets and
-- employees.department_id -> departments are RESTRICT, so the demo employees
-- must be deleted (and Adèle's refs NULLed) BEFORE outlets/departments. All
-- operational child rows are deleted first so nothing dangles to employees.
-- Includes services + payroll_periods (demo rows the original spec list omitted
-- — flushed per decision). Does NOT touch setup, Adèle's rows, or auth.users.

BEGIN;

-- 1. Operational data (leaf/child tables first — these reference employees,
--    outlets, tip_sheets, etc.; clearing them releases those FKs).
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

-- 2. Release Adèle's references to config rows we're about to delete (she's
--    kept; don't leave her pointing at a deleted outlet/department). Already
--    NULL in practice — idempotent.
UPDATE employees SET home_outlet_id = NULL, department_id = NULL
WHERE first_name = 'Adèle' AND last_name = 'Chappuis';

-- 3. PTO balances — keep only Adèle's (before deleting employees).
DELETE FROM pto_balances
WHERE employee_id NOT IN (
  SELECT id FROM employees WHERE first_name = 'Adèle' AND last_name = 'Chappuis'
);

-- 4. Employees — keep only Adèle. MUST come before outlets/departments so the
--    demo rows' home_outlet_id / department_id references release.
DELETE FROM employees
WHERE NOT (first_name = 'Adèle' AND last_name = 'Chappuis');

-- 5. Config / demo setup (children before parents: outlet_roles -> tip_pools,
--    then everything -> outlets -> departments).
DELETE FROM outlet_roles;
DELETE FROM tip_pools;
DELETE FROM services;
DELETE FROM outlet_services;
DELETE FROM outlets;
DELETE FROM departments;

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

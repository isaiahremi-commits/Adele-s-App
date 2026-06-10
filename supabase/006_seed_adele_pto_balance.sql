-- Migration 006 — seed Adèle's pto_balances row.
-- Her employees row was created (timecards.sql) after Migration 001's
-- pto_balances seeder ran, so she has no balance row and is missing from the
-- /pto balances table. Idempotent — ON CONFLICT keeps it a no-op on re-run.
-- Run in the Supabase SQL editor.

BEGIN;

INSERT INTO pto_balances (employee_id, balance_hours)
SELECT id, 0 FROM employees
WHERE first_name = 'Adèle' AND last_name = 'Chappuis'
ON CONFLICT (employee_id) DO NOTHING;

COMMIT;

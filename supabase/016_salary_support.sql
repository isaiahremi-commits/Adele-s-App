-- =========================================================================
-- Migration 016 — salary pay type for management employees (schema add).
-- Run in the Supabase SQL editor. Idempotent.
--
-- Adds employees.pay_type ('hourly' default) and employees.annual_salary.
-- Every existing employee defaults to 'hourly' — no behavior change. Adèle
-- backfills management staff to 'salary' via the employee form.
--
-- No CHECK constraint on pay_type: the "salary requires annual_salary" rule is
-- enforced at the app layer so this migration (and future writes) never break.
-- =========================================================================

alter table employees add column if not exists pay_type text not null default 'hourly';
alter table employees add column if not exists annual_salary numeric;

NOTIFY pgrst, 'reload schema';

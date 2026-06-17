-- =========================================================================
-- Day-4 fixup — verify / restore setup.period_start_day (scheduling regression 2).
-- Run in the Supabase SQL editor. NOT a migration.
--
-- The scheduling week-anchor code was NOT changed in the day-4 PR (verified via
-- git), and it reads setup.period_start_day correctly. A Monday-anchored grid
-- when Adèle expects Saturday means the stored value is no longer 'saturday'
-- (NULL, blank, or changed). Check it, then restore if needed.
-- =========================================================================

-- 1) Inspect the current value.
SELECT id, company_name, pay_cycle, period_start_day FROM setup;

-- 2) If period_start_day is not exactly 'saturday', restore it.
--    (Safe to run; only normalizes the one column.)
UPDATE setup SET period_start_day = 'saturday', updated_at = now()
WHERE period_start_day IS DISTINCT FROM 'saturday';

-- 3) Confirm.
SELECT period_start_day FROM setup;

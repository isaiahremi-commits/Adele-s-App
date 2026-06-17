-- =========================================================================
-- Day-4 item 1A — ONE-TIME manual schedule reset. NOT a migration; run once
-- in the Supabase SQL editor before/with the Day-4 deploy.
--
-- Clears all shifts and approval locks so Adèle starts from a blank schedule.
-- Employees, outlets, roles, PTO requests and tip sheets are preserved.
--
-- Run this BEFORE migration 021 so the old single-column approved_weeks rows
-- are gone before the composite (period_start_date, outlet_id) PK is applied.
-- =========================================================================

BEGIN;
DELETE FROM approved_weeks;
DELETE FROM shifts;
COMMIT;

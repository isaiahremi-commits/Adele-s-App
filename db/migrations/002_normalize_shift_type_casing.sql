-- Migration 002 — normalize shifts.shift_type casing to lowercase.
--
-- The uppercase values originate in outlet_services.name (the scheduling form
-- writes the selected service name as shift_type). This migration cleans the
-- existing shifts data. WHERE guards make it idempotent / re-runnable —
-- already-lowercased rows are skipped.
--
-- Chosen path is app-layer enforcement (no CHECK constraint per scope). Reads
-- are left untouched; they match either casing until the data is clean.
--
-- Run in the Supabase SQL editor.

BEGIN;

UPDATE shifts SET shift_type = 'am'            WHERE shift_type = 'AM';
UPDATE shifts SET shift_type = 'pm'            WHERE shift_type = 'PM';
UPDATE shifts SET shift_type = 'tea service'   WHERE shift_type = 'Tea Service';
UPDATE shifts SET shift_type = 'all day'       WHERE shift_type = 'All Day';
UPDATE shifts SET shift_type = 'concert night' WHERE shift_type = 'Concert Night';

COMMIT;

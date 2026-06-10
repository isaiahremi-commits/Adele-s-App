-- Migration 005 — normalize tip_sheets.shift_type casing to lowercase.
-- (Migration 002 follow-up — 002 normalized shifts.shift_type but missed
-- tip_sheets.shift_type.) Run in the Supabase SQL editor. Idempotent.
--
-- tip_sheets has a unique constraint idx_tip_sheets_auto_unique
-- (outlet_id, shift_type, date), so some uppercase rows can't simply be
-- lowercased — they collide with an existing lowercase twin. Those uppercase
-- rows are stale, empty/pending duplicates from before Migration 002; the
-- lowercase twin is canonical (one is an approved sheet with real amounts).
-- Step 1 removes those stale duplicates; step 2 lowercases the survivors.

BEGIN;

-- 1. Drop stale uppercase duplicates that collide with a canonical lowercase
--    twin at the same outlet+date (their tip_sheet_rows cascade).
DELETE FROM tip_sheets t
WHERE t.shift_type IS NOT NULL
  AND t.shift_type <> lower(t.shift_type)
  AND EXISTS (
    SELECT 1 FROM tip_sheets x
    WHERE x.outlet_id IS NOT DISTINCT FROM t.outlet_id
      AND x.date = t.date
      AND x.shift_type = lower(t.shift_type)
  );

-- 2. Lowercase the survivors (explicit per value, mirroring Migration 002;
--    WHERE-guarded so re-running is a no-op).
UPDATE tip_sheets SET shift_type = 'am'            WHERE shift_type = 'AM';
UPDATE tip_sheets SET shift_type = 'pm'            WHERE shift_type = 'PM';
UPDATE tip_sheets SET shift_type = 'tea service'   WHERE shift_type = 'Tea Service';
UPDATE tip_sheets SET shift_type = 'concert night' WHERE shift_type = 'Concert Night';
UPDATE tip_sheets SET shift_type = 'dinner'        WHERE shift_type = 'Dinner';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify (expect 0 rows):
-- SELECT shift_type FROM tip_sheets WHERE shift_type <> lower(shift_type);

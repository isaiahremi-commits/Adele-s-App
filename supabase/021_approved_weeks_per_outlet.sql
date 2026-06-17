-- =========================================================================
-- Migration 021 — per-outlet schedule approval (Day-4 item 2).
-- Run in the Supabase SQL editor. Idempotent-ish (guarded with IF EXISTS /
-- IF NOT EXISTS); safe to re-run.
--
-- approved_weeks moves from a per-week PK (period_start_date) to a composite
-- (period_start_date, outlet_id) so a week can be approved one outlet at a
-- time. Item 1A's manual reset clears approved_weeks first, so no backfill of
-- the new NOT-NULL outlet_id is needed.
-- =========================================================================

BEGIN;

ALTER TABLE approved_weeks DROP CONSTRAINT IF EXISTS approved_weeks_pkey;
ALTER TABLE approved_weeks ADD COLUMN IF NOT EXISTS outlet_id uuid REFERENCES outlets(id);

-- Any rows that survived without an outlet can't satisfy the composite PK.
DELETE FROM approved_weeks WHERE outlet_id IS NULL;

ALTER TABLE approved_weeks ADD CONSTRAINT approved_weeks_pkey PRIMARY KEY (period_start_date, outlet_id);

COMMIT;

NOTIFY pgrst, 'reload schema';

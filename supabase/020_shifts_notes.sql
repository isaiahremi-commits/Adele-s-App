-- =========================================================================
-- Migration 020 — add shifts.notes (Day-4 item 3). Run in the Supabase SQL
-- editor. Idempotent.
--
-- Day-2 shipped click-to-edit shifts with a Notes field, but the shifts table
-- in production never had a notes column (it was only in schema.sql, which the
-- migration-built production DB doesn't apply). Saving an edited shift raised
-- "could not find 'notes' column of 'shifts' in the schema cache". Add it.
-- =========================================================================

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS notes text;

NOTIFY pgrst, 'reload schema';

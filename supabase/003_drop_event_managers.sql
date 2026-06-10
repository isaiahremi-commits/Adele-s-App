-- Migration 003 — drop the retired commission tables.
-- Run in the Supabase SQL editor.
--
-- Discovery turned up TWO tables, neither referenced by app code (the Tips
-- commission flow now lives in large_party_revenues as of PR #3):
--   - tip_event_managers (5 rows, test data) — the table Tips actually consumed
--   - event_managers      (0 rows)           — empty, not in the repo schema
-- No data is migrated (test data per the original spec). IF EXISTS makes this
-- idempotent — re-running after success is a no-op.

BEGIN;

DROP TABLE IF EXISTS tip_event_managers;
DROP TABLE IF EXISTS event_managers;

COMMIT;

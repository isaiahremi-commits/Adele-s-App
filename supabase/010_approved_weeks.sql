-- Migration 010 — approved_weeks (Item 9: lock a schedule week after approval).
-- Run in the Supabase SQL editor. Idempotent.
--
-- RLS is live (004b), so the new table gets the same manager-only policy as
-- every other table — otherwise it would be open. This follows the established
-- 004b posture (is_restaurant_manager() helper already exists); it is not a new
-- policy design.

CREATE TABLE IF NOT EXISTS approved_weeks (
  period_start_date date PRIMARY KEY,
  approved_at timestamptz DEFAULT now(),
  approved_by uuid REFERENCES employees(id)
);

ALTER TABLE approved_weeks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON approved_weeks;
CREATE POLICY manager_full_access ON approved_weeks FOR ALL TO authenticated
  USING (is_restaurant_manager()) WITH CHECK (is_restaurant_manager());

NOTIFY pgrst, 'reload schema';

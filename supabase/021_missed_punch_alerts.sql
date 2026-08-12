-- =========================================================================
-- Migration 021 (Phase 2) — missed-punch auto-alerts at 25 minutes.
-- Run in the Supabase SQL editor AFTER the applied chain (needs 005/007
-- helpers + 014's setup.timezone). REQUIRES the pg_cron extension —
-- enable it first (Dashboard → Database → Extensions → pg_cron) if the
-- CREATE EXTENSION below cannot. Idempotent; safe to re-run.
--
-- Spec: "auto-notify manager + employee 25 minutes after unclocked
-- scheduled start." PR #18 shipped the employee-initiated Running-late
-- signal; this is the SYSTEM-initiated half for silent no-shows.
--
-- CHANNEL DEVIATION (the spec allowed it): alerts are their own table,
-- NOT synthetic broadcast rows. Broadcasts are manager-authored DMs with
-- read receipts and reply threads — a system-sender row would corrupt
-- every one of those semantics. missed_punch_alerts carries the exact
-- same RLS shape as every notification-ish table (own rows + manager),
-- and the mobile Home banner / Team pill read it directly.
--
-- The scan runs from pg_cron with NO JWT, so it cannot use the
-- caller-scoped tenant helpers — it joins setup.timezone per tenant
-- itself (falling back to America/Los_Angeles, 014's default). Skipped
-- on purpose: called-out shifts (that is an EXCUSED absence, the coverage
-- flow owns it), terminated employees, shifts with no start time. The
-- scan also AUTO-RESOLVES alerts once a clock-in appears, so late
-- punch-ins clear their own flag without manager action.
-- =========================================================================

BEGIN;

-- ── 0. Fail fast ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.current_tenant_id()') IS NULL
     OR to_regprocedure('public.current_employee_id()') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — apply 005/007 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'setup'
                   AND column_name = 'timezone') THEN
    RAISE EXCEPTION 'PREREQ FAILED — setup.timezone missing; apply 014 first';
  END IF;
END $$;

-- ── 1. pg_cron ───────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    BEGIN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'pg_cron is not available — enable it in Dashboard → Database → Extensions, then re-run (%)', SQLERRM;
    END;
  END IF;
END $$;

-- ── 2. The alert table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS missed_punch_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL UNIQUE REFERENCES shifts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  alerted_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS missed_punch_alerts_tenant_id_idx ON missed_punch_alerts (tenant_id);
ALTER TABLE missed_punch_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON missed_punch_alerts;
CREATE POLICY manager_full_access ON missed_punch_alerts FOR ALL TO authenticated
  USING (public.is_restaurant_manager() AND tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS own_rows_select ON missed_punch_alerts;
CREATE POLICY own_rows_select ON missed_punch_alerts FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND employee_id = public.current_employee_id());

-- ── 3. The scan ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.scan_missed_punches()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int;
  v_resolved int;
BEGIN
  INSERT INTO missed_punch_alerts (shift_id, employee_id, tenant_id)
  SELECT s.id, s.employee_id, s.tenant_id
  FROM shifts s
  JOIN employees e ON e.id = s.employee_id
  LEFT JOIN setup st ON st.tenant_id = s.tenant_id
  WHERE s.date IS NOT NULL
    AND s.start_time IS NOT NULL
    AND e.termination_date IS NULL
    AND s.date = (now() AT TIME ZONE coalesce(st.timezone, 'America/Los_Angeles'))::date
    AND ((s.date + s.start_time) AT TIME ZONE coalesce(st.timezone, 'America/Los_Angeles'))
        + interval '25 minutes' <= now()
    AND NOT EXISTS (
      SELECT 1 FROM timecards tc
      WHERE (tc.shift_id = s.id
             OR (tc.employee_id = s.employee_id AND tc.date = s.date))
        AND tc.clock_in IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM callout_history co
      WHERE co.employee_id = s.employee_id AND co.date = s.date)
    AND NOT EXISTS (
      SELECT 1 FROM missed_punch_alerts a WHERE a.shift_id = s.id)
  ON CONFLICT (shift_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Late punch-ins clear their own alert.
  UPDATE missed_punch_alerts a
  SET resolved_at = now()
  FROM shifts s
  WHERE s.id = a.shift_id
    AND a.resolved_at IS NULL
    AND EXISTS (
      SELECT 1 FROM timecards tc
      WHERE (tc.shift_id = s.id
             OR (tc.employee_id = a.employee_id AND tc.date = s.date))
        AND tc.clock_in IS NOT NULL);
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  RETURN jsonb_build_object('inserted', v_inserted, 'resolved', v_resolved);
END;
$$;
-- cron (postgres) and service_role only — not an API surface.
REVOKE ALL ON FUNCTION public.scan_missed_punches() FROM PUBLIC, anon, authenticated;

-- ── 4. Every 5 minutes ───────────────────────────────────────────────────
-- cron.schedule upserts by jobname — re-runs replace, never duplicate.
SELECT cron.schedule('missed-punch-scan', '*/5 * * * *',
                     'SELECT public.scan_missed_punches()');

-- ── 5. Assertions ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.missed_punch_alerts') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — missed_punch_alerts missing';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE tablename = 'missed_punch_alerts'
      AND policyname IN ('manager_full_access', 'own_rows_select')) <> 2 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — missed_punch_alerts policies wrong';
  END IF;
  IF to_regprocedure('public.scan_missed_punches()') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — scan_missed_punches missing';
  END IF;
  IF has_function_privilege('authenticated', 'public.scan_missed_punches()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED — scan_missed_punches callable from the API';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'missed-punch-scan') THEN
    RAISE EXCEPTION 'ASSERTION FAILED — cron job missed-punch-scan not registered';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run by hand after applying) ────────────────────────────
-- 1. Job registered:
SELECT jobname, schedule FROM cron.job WHERE jobname = 'missed-punch-scan';
-- 2. Dry run now (expect {"inserted": N, "resolved": M}):
SELECT public.scan_missed_punches();
-- 3. End-to-end: insert a shift for a linked employee starting 30 min ago
--    with no timecard, wait ≤5 min, then:
--    SELECT * FROM missed_punch_alerts ORDER BY alerted_at DESC LIMIT 5;

-- ── Rollback (run by hand only) ──────────────────────────────────────────
-- SELECT cron.unschedule('missed-punch-scan');
-- DROP FUNCTION IF EXISTS public.scan_missed_punches();
-- DROP TABLE IF EXISTS missed_punch_alerts;

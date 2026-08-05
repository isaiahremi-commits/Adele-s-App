-- =========================================================================
-- Migration 008 (Phase 2) — Employee pay + disciplinary visibility.
-- Run in the Supabase SQL editor AFTER 005 + 007 (and the Phase 1 pay
-- engine through migration 017). Idempotent (OR REPLACE / DROP IF EXISTS
-- guards); safe to re-run. One transaction — all or nothing.
--
-- NOTE ON NUMBERING: Phase 1 already has 008_flush_test_data.sql in this
-- folder. Like 005/006/007, this file continues the Phase 2 sequence per
-- the PR #6 spec — filenames don't collide and migrations are applied by
-- hand, so the overlap is cosmetic only.
--
-- What this does:
--   1. Own-row SELECT policies (additive to the 005 manager policies, same
--      shape and name as 007's) on timecards / lateness_history /
--      callout_history: an employee can read rows whose employee_id is
--      their own. First employee-grade read access to pay + disciplinary
--      data.
--   2. pay_breakdown_for_me(p_start, p_end [, p_mode]) — the employee's own
--      pay_breakdown row. SECURITY DEFINER; infers the employee from
--      auth.uid() via current_employee_id() (never trusts a passed id) and
--      rejects callers with no linked employee row. DELIBERATELY DELEGATES
--      to pay_breakdown() and filters to the caller's employee_id instead
--      of duplicating the 160-line pay engine: migrations 013/014/015/017
--      each revised that engine, and a copy here would silently drift on
--      the next revision. employee ids are globally-unique uuids, so the
--      filter cannot match another tenant's row. A fail-fast assertion
--      below pins the two functions' result signatures together — if a
--      future migration changes pay_breakdown's columns without updating
--      this wrapper, THIS migration re-run (or its verification) fails
--      loudly instead of the API drifting.
--      p_mode is an optional extension over the PR #6 spec signature
--      (default 'actual', same values as pay_breakdown) so the mobile
--      current-period card can show a projected gross via 'prediction'
--      mode exactly like the web /payroll prediction toggle. Two-arg calls
--      match the spec exactly.
--   3. employee_pay_settings() — documented spec ADDITION. setup is
--      manager-only under RLS (005), but the Pay tab needs
--      setup.pay_cycle + period_start_day to compute period boundaries
--      client-side (the mobile analog of the web's /api/setup fetch — the
--      period anchor lives in shared/payroll.ts, not the DB) and
--      setup.callout_threshold_count / _window_days for the standing
--      card's threshold warning. Exposes exactly those four config values
--      to any linked employee — nothing else from setup.
--   4. Fail-fast assertions inside the transaction (prerequisites up
--      front, results at the end); verification after COMMIT; commented
--      rollback at the bottom.
--
-- KNOWN LIMITATION (single-tenant pilot): pay_breakdown internally reads
-- `select pay_cycle from setup limit 1` (salary periods-per-year) with no
-- tenant filter — under a manager JWT, RLS scoped that read; under this
-- SECURITY DEFINER delegation, RLS is bypassed and `limit 1` would pick an
-- arbitrary tenant's setup row if several existed. With one tenant (Adele
-- Pilot) the row is unambiguous. Revisit pay_breakdown itself before
-- onboarding a second tenant — flagged in build-status.
-- =========================================================================

BEGIN;

-- ── 0. Fail-fast prerequisites: 005 + 007 + pay engine must be applied ───
DO $$
DECLARE t text;
BEGIN
  IF to_regprocedure('public.current_tenant_id()') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — current_tenant_id() missing; apply migration 005 first';
  END IF;
  IF to_regprocedure('public.current_employee_id()') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — current_employee_id() missing; apply migration 007 first';
  END IF;
  IF to_regprocedure('public.pay_breakdown(date, date, text)') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — pay_breakdown(date, date, text) missing; apply the pay engine (through migration 017) first';
  END IF;

  FOR t IN SELECT unnest(ARRAY['timecards', 'lateness_history', 'callout_history']) LOOP
    -- tenant_id + employee_id columns (005 added tenant_id; employee_id is original DDL).
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = t
        AND c.column_name = 'tenant_id'
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = t
        AND c.column_name = 'employee_id'
    ) THEN
      RAISE EXCEPTION 'PREREQUISITE FAILED — % lacks tenant_id/employee_id; apply migration 005 first', t;
    END IF;
    -- RLS must actually be ON (004b) — an own-row policy on a table with RLS
    -- disabled would be decorative while the table serves everything.
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'PREREQUISITE FAILED — RLS is disabled on %; apply 004b/005 first', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'setup'
      AND column_name IN ('pay_cycle', 'period_start_day',
                          'callout_threshold_count', 'callout_threshold_window_days')
    HAVING count(*) = 4
  ) THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — setup lacks pay/callout config columns';
  END IF;
END $$;

-- ── 1. Own-row SELECT policies (additive; manager policies untouched) ────
DROP POLICY IF EXISTS own_rows_select ON timecards;
CREATE POLICY own_rows_select ON timecards FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND employee_id = public.current_employee_id());

DROP POLICY IF EXISTS own_rows_select ON lateness_history;
CREATE POLICY own_rows_select ON lateness_history FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND employee_id = public.current_employee_id());

DROP POLICY IF EXISTS own_rows_select ON callout_history;
CREATE POLICY own_rows_select ON callout_history FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND employee_id = public.current_employee_id());

-- ── 2. pay_breakdown_for_me: the caller's own pay_breakdown row ──────────
-- Return signature MUST stay identical to pay_breakdown's (asserted below).
-- DROP first for signature-change safety on re-runs, mirroring 017.
DROP FUNCTION IF EXISTS pay_breakdown_for_me(date, date, text);

CREATE OR REPLACE FUNCTION pay_breakdown_for_me(
  p_start date,
  p_end   date,
  p_mode  text DEFAULT 'actual'
) RETURNS TABLE (
  employee_id     uuid,
  first_name      text,
  last_name       text,
  title           text,
  department      text,
  job_position    text,
  outlet_name     text,
  regular_hours   numeric,
  ot_hours        numeric,
  training_hours  numeric,
  pto_hours       numeric,
  projected_hours numeric,
  approved_count  int,
  scheduled_count int,
  regular_rate    numeric,
  ot_rate_effective numeric,
  training_rate   numeric,
  pto_rate        numeric,
  regular_pay     numeric,
  ot_pay          numeric,
  training_pay    numeric,
  pto_pay         numeric,
  manager_amount  numeric,
  tip_rows_amount numeric,
  sc_tips         numeric,
  nc_tips         numeric,
  tip_pay         numeric,
  gross_pay       numeric,
  has_missing_rate boolean,
  warnings        text[],
  pay_type        text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  IF p_start IS NULL OR p_end IS NULL THEN
    RAISE EXCEPTION 'Start and end dates are required';
  END IF;
  IF p_start > p_end THEN
    RAISE EXCEPTION 'Start date must be on or before end date';
  END IF;
  IF lower(coalesce(p_mode, 'actual')) NOT IN ('actual', 'prediction') THEN
    RAISE EXCEPTION 'Invalid mode (use actual or prediction)';
  END IF;

  -- Employee ids are globally-unique uuids and v_emp is tenant-scoped by
  -- current_employee_id(), so this filter can only ever match the caller's
  -- own row.
  RETURN QUERY
  SELECT * FROM pay_breakdown(p_start, p_end, p_mode) pb
  WHERE pb.employee_id = v_emp;
END;
$$;

-- ── 3. employee_pay_settings: the four config values the Pay tab needs ───
-- Always returns exactly one row; defaults mirror the web fallbacks
-- (lib/payroll.ts cycleLength → biweekly, lib/reports.ts → 3 per 30 days).
CREATE OR REPLACE FUNCTION employee_pay_settings()
RETURNS TABLE (
  pay_cycle                     text,
  period_start_day              text,
  callout_threshold_count       int,
  callout_threshold_window_days int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF public.current_employee_id() IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;

  RETURN QUERY
  SELECT coalesce(s.pay_cycle, 'biweekly'),
         coalesce(s.period_start_day, 'saturday'),
         coalesce(s.callout_threshold_count, 3),
         coalesce(s.callout_threshold_window_days, 30)
  FROM (SELECT 1) one
  LEFT JOIN setup s ON s.tenant_id = public.current_tenant_id()
  LIMIT 1;
END;
$$;

-- Employee-callable, and nothing else.
REVOKE ALL ON FUNCTION pay_breakdown_for_me(date, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION employee_pay_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pay_breakdown_for_me(date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION employee_pay_settings() TO authenticated;

-- ── 4. Fail-fast assertions ──────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  -- The three own-row policies exist AND are tenant- + employee-scoped.
  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND policyname = 'own_rows_select'
    AND tablename IN ('timecards', 'lateness_history', 'callout_history')
    AND cmd = 'SELECT'
    AND qual LIKE '%current_tenant_id%'
    AND qual LIKE '%current_employee_id%';
  IF n <> 3 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — expected 3 scoped own_rows_select policies, found %', n;
  END IF;

  IF to_regprocedure('public.pay_breakdown_for_me(date, date, text)') IS NULL
     OR to_regprocedure('public.employee_pay_settings()') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — employee pay RPC(s) missing';
  END IF;

  -- Drift alarm: pay_breakdown_for_me must return EXACTLY pay_breakdown's
  -- columns. If a future migration revises the pay engine's signature
  -- (as 015 and 017 did) without updating the wrapper, fail loudly here.
  IF pg_get_function_result('public.pay_breakdown(date, date, text)'::regprocedure)
     IS DISTINCT FROM
     pg_get_function_result('public.pay_breakdown_for_me(date, date, text)'::regprocedure) THEN
    RAISE EXCEPTION 'ASSERTION FAILED — pay_breakdown_for_me result signature has drifted from pay_breakdown; update the wrapper in 008 to match';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run after COMMIT) ──────────────────────────────────────
-- 3 rows, one per table:
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE policyname = 'own_rows_select'
  AND tablename IN ('timecards', 'lateness_history', 'callout_history')
ORDER BY tablename;
-- 2 rows, the employee RPCs:
SELECT proname, pg_get_function_identity_arguments(oid) AS args,
       prosecdef AS security_definer
FROM pg_proc
WHERE proname IN ('pay_breakdown_for_me', 'employee_pay_settings')
ORDER BY proname;
-- Identical result signatures (must return one row):
SELECT 1 AS signatures_match
WHERE pg_get_function_result('public.pay_breakdown(date, date, text)'::regprocedure)
    = pg_get_function_result('public.pay_breakdown_for_me(date, date, text)'::regprocedure);
-- Smoke test — NOT from the SQL editor (it has no JWT, so both RPCs raise
-- 'No tenant on your session' there; that raise IS the negative test).
-- From a signed-in client instead:
--   supabase.rpc('employee_pay_settings')            → one row of config
--   supabase.rpc('pay_breakdown_for_me', {...})      → caller's row only

-- ── Rollback (run by hand only) ──────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS own_rows_select ON timecards;
-- DROP POLICY IF EXISTS own_rows_select ON lateness_history;
-- DROP POLICY IF EXISTS own_rows_select ON callout_history;
-- DROP FUNCTION IF EXISTS pay_breakdown_for_me(date, date, text);
-- DROP FUNCTION IF EXISTS employee_pay_settings();
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- Migration 026 (Phase 2 PR #27) — pay_ytd_for_me: calendar-year-to-date
-- aggregates for the calling employee (mobile Pay tab YTD toggle).
-- Run in the Supabase SQL editor AFTER 005/007/008. Idempotent.
--
-- Sums the ALREADY-STORED per-timecard hours (approved/posted) rather than
-- re-running pay_breakdown over the year: 023's OT threshold is per-period
-- and re-splitting a 12-month range would corrupt the reg/OT numbers.
--
-- Gross basis (judgment call, documented in the PR):
--   * hourly — stored hours × the employee's CURRENT rates + own tip rows
--     + manager commission YTD. The schema keeps no rate history, so
--     current rates are the only possible basis; a mid-year raise shifts
--     the estimate accordingly.
--   * salaried — gross_pay is NULL (periods-elapsed × salary would need
--     the period anchor duplicated into SQL, and a fraction-of-year figure
--     misleads). The UI explains; pay_type is returned so it can.
-- Guards raise (targeted read, pay_breakdown_for_me's stance) — this is
-- tap-triggered, not a polled feed, so 020's soft-return rule is N/A.
-- =========================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.current_tenant_id()') IS NULL
     OR to_regprocedure('public.current_employee_id()') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — apply 005/007 first';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.pay_ytd_for_me();

CREATE FUNCTION public.pay_ytd_for_me()
RETURNS TABLE (
  year            int,
  regular_hours   numeric,
  ot_hours        numeric,
  training_hours  numeric,
  pto_hours       numeric,
  sc_tips         numeric,
  nc_tips         numeric,
  tip_pay         numeric,
  manager_amount  numeric,
  gross_pay       numeric,
  pay_type        text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  y_start date := date_trunc('year', current_date)::date;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;

  RETURN QUERY
  WITH tc AS (
    SELECT round(coalesce(sum(t.regular_hours), 0), 2)  AS reg,
           round(coalesce(sum(t.ot_hours), 0), 2)       AS ot,
           round(coalesce(sum(t.training_hours), 0), 2) AS trn
    FROM timecards t
    WHERE t.employee_id = v_emp
      AND t.status IN ('approved','posted')
      AND t.date >= y_start AND t.date <= current_date
  ),
  pto AS (
    SELECT round(coalesce(sum(pa.paid_hours), 0), 2) AS hrs
    FROM pto_allocations pa
    WHERE pa.employee_id = v_emp
      AND pa.date >= y_start AND pa.date <= current_date
  ),
  tips AS (
    SELECT round(coalesce(sum(tsr.tip_amount), 0), 2)              AS amt,
           round(coalesce(sum(coalesce(tsr.sc_amount, 0)), 0), 2)  AS sc,
           round(coalesce(sum(coalesce(tsr.nc_amount, 0)), 0), 2)  AS nc
    FROM tip_sheet_rows tsr
    JOIN tip_sheets ts ON ts.id = tsr.tip_sheet_id
    WHERE tsr.employee_id = v_emp
      AND ts.status IN ('approved','posted')
      AND ts.date >= y_start AND ts.date <= current_date
  ),
  mgr AS (
    SELECT round(coalesce(sum(lpr.manager_amount), 0), 2) AS amt
    FROM large_party_revenues lpr
    JOIN tip_sheets ts ON ts.id = lpr.tip_sheet_id
    WHERE lpr.manager_employee_id = v_emp
      AND ts.status IN ('approved','posted')
      AND ts.date >= y_start AND ts.date <= current_date
  ),
  me AS (
    SELECT coalesce(e.pay_type, 'hourly') AS pay_type,
           e.regular_rate, e.ot_rate, e.training_rate, e.pto_rate
    FROM employees e WHERE e.id = v_emp
  )
  SELECT
    extract(year FROM current_date)::int AS year,
    tc.reg   AS regular_hours,
    tc.ot    AS ot_hours,
    tc.trn   AS training_hours,
    pto.hrs  AS pto_hours,
    tips.sc  AS sc_tips,
    tips.nc  AS nc_tips,
    round(tips.amt + mgr.amt, 2) AS tip_pay,
    mgr.amt  AS manager_amount,
    CASE WHEN me.pay_type = 'salary' THEN NULL
         WHEN me.regular_rate IS NULL THEN NULL
         ELSE round(
             tc.reg * me.regular_rate
           + tc.ot  * coalesce(me.ot_rate, 0)
           + tc.trn * coalesce(me.training_rate, 0)
           + pto.hrs * coalesce(me.pto_rate, 0)
           + tips.amt + mgr.amt, 2)
    END AS gross_pay,
    me.pay_type
  FROM tc, pto, tips, mgr, me;
END;
$$;

REVOKE ALL ON FUNCTION public.pay_ytd_for_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_ytd_for_me() TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.pay_ytd_for_me()') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — pay_ytd_for_me missing';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.pay_ytd_for_me()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.pay_ytd_for_me()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED — pay_ytd_for_me grants wrong';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification (as a linked employee): SELECT * FROM public.pay_ytd_for_me();
-- Rollback: DROP FUNCTION IF EXISTS public.pay_ytd_for_me();

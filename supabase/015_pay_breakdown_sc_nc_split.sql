-- =========================================================================
-- Migration 015 — split payroll tip pay into SC tips + NC tips (Day-3 item 2).
-- Run in the Supabase SQL editor. Idempotent (CREATE OR REPLACE FUNCTION).
--
-- Migration 013 added tip_sheet_rows.sc_amount / nc_amount. pay_breakdown now
-- returns sc_tips (sum of sc_amount) and nc_tips (sum of nc_amount) alongside
-- the existing tip_rows_amount / tip_pay. Because tip_amount = sc_amount +
-- nc_amount, sc_tips + nc_tips == tip_rows_amount and gross_pay is unchanged.
-- Manager commission (2% large-party) stays its own column — not a tip.
--
-- Only the tiprows CTE and the output column list differ from migration 014.
--
-- The return signature changes (adds sc_tips / nc_tips), so the existing
-- function is dropped first — Postgres CREATE OR REPLACE can't alter a
-- function's return type (error 42P13).
-- =========================================================================

drop function if exists pay_breakdown(date, date, text);

create or replace function pay_breakdown(
  p_start date,
  p_end   date,
  p_mode  text default 'actual'
) returns table (
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
  warnings        text[]
)
language sql stable as $$
  with mode as (select lower(coalesce(p_mode, 'actual')) as m),
  tc as (
    select employee_id,
           sum(regular_hours)  as reg,
           sum(ot_hours)       as ot,
           sum(training_hours) as trn,
           count(*)            as approved_cnt
    from timecards
    where date between p_start and p_end and status in ('approved','posted')
    group by employee_id
  ),
  sh as (
    select s.employee_id,
           count(*) as sched_cnt,
           sum(
             case when exists (
               select 1 from timecards t
               where t.shift_id = s.id and t.status in ('approved','posted')
             ) then 0
             else greatest(0, extract(epoch from (
                    (case when (s.date::text||' '||s.end_time::text)::timestamp
                               <= (s.date::text||' '||s.start_time::text)::timestamp
                          then (s.date::text||' '||s.end_time::text)::timestamp + interval '1 day'
                          else (s.date::text||' '||s.end_time::text)::timestamp end)
                    - (s.date::text||' '||s.start_time::text)::timestamp)) / 3600.0)
             end
           ) as proj_hours
    from shifts s
    where s.date between p_start and p_end
      and s.start_time is not null and s.end_time is not null
    group by s.employee_id
  ),
  pto as (
    select employee_id, sum(paid_hours) as pto_hours
    from pto_allocations
    where date between p_start and p_end
    group by employee_id
  ),
  mgr as (
    select lpr.manager_employee_id as employee_id, sum(lpr.manager_amount) as mgr_amt
    from large_party_revenues lpr
    join tip_sheets ts on ts.id = lpr.tip_sheet_id
    where ts.status in ('approved','posted') and ts.date between p_start and p_end
    group by lpr.manager_employee_id
  ),
  -- Per-row tip distribution from posted/approved tip sheets, now split by the
  -- SC and NC pools (Day-3 item 2). amt stays = sc + nc for gross continuity.
  tiprows as (
    select tsr.employee_id,
           sum(tsr.tip_amount) as amt,
           sum(coalesce(tsr.sc_amount, 0)) as sc_amt,
           sum(coalesce(tsr.nc_amount, 0)) as nc_amt
    from tip_sheet_rows tsr
    join tip_sheets ts on ts.id = tsr.tip_sheet_id
    where ts.status in ('approved','posted') and ts.date between p_start and p_end
    group by tsr.employee_id
  ),
  base as (
    select
      e.id as employee_id, e.first_name, e.last_name, e.title,
      coalesce(d.name, e.department) as department,
      coalesce(e.home_position, e.position) as job_position,
      o.name as outlet_name,
      round(coalesce(tc.reg, 0), 2)  as reg_actual,
      round(coalesce(tc.ot, 0), 2)   as ot_hours,
      round(coalesce(tc.trn, 0), 2)  as training_hours,
      round(coalesce(pto.pto_hours, 0), 2) as pto_hours,
      round(coalesce(sh.proj_hours, 0), 2) as projected_hours,
      coalesce(tc.approved_cnt, 0)::int as approved_count,
      coalesce(sh.sched_cnt, 0)::int    as scheduled_count,
      e.regular_rate, e.ot_rate, e.training_rate, e.pto_rate,
      coalesce(mgr.mgr_amt, 0)       as manager_amount,
      round(coalesce(tr.amt, 0), 2)  as tip_rows_amount,
      round(coalesce(tr.sc_amt, 0), 2) as sc_tips,
      round(coalesce(tr.nc_amt, 0), 2) as nc_tips,
      (select m from mode)           as m
    from employees e
    left join tc  on tc.employee_id  = e.id
    left join sh  on sh.employee_id  = e.id
    left join pto on pto.employee_id = e.id
    left join mgr on mgr.employee_id = e.id
    left join tiprows tr on tr.employee_id = e.id
    left join departments d on d.id = e.department_id
    left join outlets o     on o.id = e.home_outlet_id
    where tc.employee_id is not null
       or sh.employee_id is not null
       or pto.employee_id is not null
       or mgr.employee_id is not null
       or tr.employee_id is not null
  ),
  calc as (
    select b.*,
      case when b.m = 'prediction' then round(b.reg_actual + b.projected_hours, 2)
           else b.reg_actual end as reg_used,
      -- Item 13: OT rate is entered manually; no regular_rate * 1.5 fallback.
      b.ot_rate as ot_rate_eff
    from base b
  ),
  pays as (
    select c.*,
      case when c.reg_used = 0 then 0
           when c.regular_rate is null then null
           else round(c.reg_used * c.regular_rate, 2) end as regular_pay,
      case when c.ot_hours = 0 then 0
           when c.ot_rate_eff is null then null
           else round(c.ot_hours * c.ot_rate_eff, 2) end as ot_pay,
      case when c.training_hours = 0 then 0
           when c.training_rate is null then null
           else round(c.training_hours * c.training_rate, 2) end as training_pay,
      case when c.pto_hours = 0 then 0
           when c.pto_rate is null then null
           else round(c.pto_hours * c.pto_rate, 2) end as pto_pay,
      round(c.manager_amount + c.tip_rows_amount, 2) as tip_pay
    from calc c
  )
  select
    p.employee_id, p.first_name, p.last_name, p.title, p.department, p.job_position, p.outlet_name,
    p.reg_used        as regular_hours,
    p.ot_hours, p.training_hours, p.pto_hours, p.projected_hours,
    p.approved_count, p.scheduled_count,
    p.regular_rate, p.ot_rate_eff as ot_rate_effective, p.training_rate, p.pto_rate,
    p.regular_pay, p.ot_pay, p.training_pay, p.pto_pay,
    p.manager_amount, p.tip_rows_amount, p.sc_tips, p.nc_tips, p.tip_pay,
    -- gross is null when any needed rate is missing (don't show a misleading total)
    case when (p.regular_pay is null or p.ot_pay is null or p.training_pay is null or p.pto_pay is null)
         then null
         else round(coalesce(p.regular_pay,0) + coalesce(p.ot_pay,0)
                  + coalesce(p.training_pay,0) + coalesce(p.pto_pay,0) + p.tip_pay, 2)
    end as gross_pay,
    (p.regular_pay is null or p.ot_pay is null or p.training_pay is null or p.pto_pay is null) as has_missing_rate,
    (
      -- Item 17: human-readable warnings (no leaked column names).
      array_remove(array[
        case when p.regular_pay is null then 'Missing regular rate' end,
        case when p.ot_pay is null      then 'Missing OT rate' end,
        case when p.training_pay is null then 'Missing training rate' end,
        case when p.pto_pay is null     then 'Missing PTO rate' end
      ], null)
    ) as warnings
  from pays p
  order by p.first_name, p.last_name;
$$;

NOTIFY pgrst, 'reload schema';

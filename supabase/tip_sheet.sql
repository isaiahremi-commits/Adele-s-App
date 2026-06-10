-- =========================================================================
-- Manadele — Tip Sheet Engine + Commission (Tier 1, item #3)
-- Run this in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Generates tip sheets from approved timecards, applies the LOCKED large-party
-- commission split (25% service charge -> 20% pool / 3% house / 2% manager),
-- and distributes tips per outlet config (pool vs individual). Writes
-- tip_sheet_rows.tip_amount + large_party_revenues amounts; the pay engine
-- reads tip_sheet_rows.tip_amount (pay_breakdown updated at the bottom).
--
-- Status flow: pending (entries) -> ready (to approve) -> posted (locked).
-- Legacy 'approved' sheets are treated as locked/feeds-pay for back-compat.
--
-- Rules honored: hours are READ from timecards.regular_hours+ot_hours (never
-- recomputed); called-out (callout_history) + PTO (pto_allocations.paid_hours)
-- + training hours are excluded; the 20/3/2 split is the locked formula;
-- per-position points / tip-out % / pool mode are read from outlet_roles /
-- outlets; missing config -> the engine RAISES (never silently distributes $0).
-- =========================================================================

-- New columns. tip_amount is read by the pay engine; the other three back
-- individual-mode per-employee entry + resolved role for display.
alter table tip_sheet_rows add column if not exists tip_amount numeric(10,2);
alter table tip_sheet_rows add column if not exists declared_service_charge numeric(10,2);
alter table tip_sheet_rows add column if not exists declared_non_cash numeric(10,2);
alter table tip_sheet_rows add column if not exists role text;


-- -------------------------------------------------------------------------
-- ts_add_large_party: declare a large party on a sheet. Commission amounts
-- stay null until ts_compute runs. Manager defaults to the Restaurant Manager.
-- -------------------------------------------------------------------------
create or replace function ts_add_large_party(
  p_tip_sheet_id uuid,
  p_revenue numeric,
  p_manager_employee_id uuid default null
) returns jsonb
language plpgsql security definer as $$
declare v_id uuid; v_mgr uuid;
begin
  if not exists (select 1 from tip_sheets where id = p_tip_sheet_id) then
    raise exception 'Tip sheet % not found', p_tip_sheet_id;
  end if;
  v_mgr := p_manager_employee_id;
  if v_mgr is null then
    select id into v_mgr from employees where title = 'Restaurant Manager' order by created_at limit 1;
  end if;
  insert into large_party_revenues (tip_sheet_id, revenue, manager_employee_id)
  values (p_tip_sheet_id, coalesce(p_revenue,0), v_mgr)
  returning id into v_id;
  return (select to_jsonb(l) from large_party_revenues l where id = v_id);
end;$$;


-- -------------------------------------------------------------------------
-- ts_reassign_manager: change which Restaurant Manager earns the 2% on a party.
-- -------------------------------------------------------------------------
create or replace function ts_reassign_manager(
  p_lpr_id uuid,
  p_manager_employee_id uuid
) returns jsonb
language plpgsql security definer as $$
begin
  update large_party_revenues set manager_employee_id = p_manager_employee_id where id = p_lpr_id;
  if not found then raise exception 'Large party revenue % not found', p_lpr_id; end if;
  return (select to_jsonb(l) from large_party_revenues l where id = p_lpr_id);
end;$$;


-- -------------------------------------------------------------------------
-- ts_compute: the engine. Idempotent — recomputing overwrites tip_amount.
-- Transitions pending|ready -> ready. One transaction (function body).
-- -------------------------------------------------------------------------
create or replace function ts_compute(p_tip_sheet_id uuid)
returns jsonb
language plpgsql security definer as $$
declare
  v_sheet    tip_sheets%rowtype;
  v_mode     text;
  v_sc       numeric;
  v_nc       numeric;
  v_pullback numeric := 0;
  v_pool     numeric;
  v_weight   numeric;
  v_missing  text[];
  v_servers_base numeric;
begin
  select * into v_sheet from tip_sheets where id = p_tip_sheet_id;
  if not found then raise exception 'Tip sheet % not found', p_tip_sheet_id; end if;
  if v_sheet.status not in ('pending','ready') then
    raise exception 'Cannot compute a % tip sheet', v_sheet.status;
  end if;
  if v_sheet.outlet_id is null then raise exception 'Tip sheet has no outlet'; end if;

  select tip_pool_mode into v_mode from outlets where id = v_sheet.outlet_id;
  if v_mode is null then raise exception 'Outlet has no tip_pool_mode configured'; end if;

  -- LOCKED large-party split off party revenue: 20% pool / 3% house / 2% manager.
  update large_party_revenues
     set pool_amount    = round(revenue * 0.20, 2),
         house_amount   = round(revenue * 0.03, 2),
         manager_amount = round(revenue * 0.02, 2)
   where tip_sheet_id = p_tip_sheet_id;
  select coalesce(sum(house_amount + manager_amount), 0) into v_pullback
    from large_party_revenues where tip_sheet_id = p_tip_sheet_id;

  v_sc := coalesce(v_sheet.service_charge, 0);
  v_nc := coalesce(v_sheet.non_cash_tips, 0);

  -- Resolve each team member's eligible hours / points / role for this date.
  -- eligible_hours = SUM(regular+ot) approved/posted timecards that day, minus
  -- PTO paid_hours; called-out members get 0 hours (excluded). Training hours
  -- never enter (we only sum regular+ot). points/role from outlet_roles.
  drop table if exists _ts_elig;
  create temporary table _ts_elig as
  select
    tsr.id as row_id,
    tsr.employee_id,
    coalesce(tsr.declared_service_charge, 0) as decl_sc,
    coalesce(tsr.declared_non_cash, 0)       as decl_nc,
    case when co.employee_id is not null then 0
         else greatest(0, coalesce(tc.h, 0) - coalesce(pt.pto, 0)) end as eff_hours,
    coalesce(sh.position, emp.home_position, emp.position) as role,
    orl.points    as points,
    orl.tip_out_pct as tip_out_pct,
    orl.tip_out_revenue_source as tip_out_src
  from tip_sheet_rows tsr
  join employees emp on emp.id = tsr.employee_id
  left join lateral (
    select sum(regular_hours + ot_hours) as h from timecards
    where employee_id = tsr.employee_id and date = v_sheet.date and status in ('approved','posted')
  ) tc on true
  left join lateral (
    select sum(paid_hours) as pto from pto_allocations
    where employee_id = tsr.employee_id and date = v_sheet.date
  ) pt on true
  left join lateral (
    select position from shifts
    where employee_id = tsr.employee_id and date = v_sheet.date and outlet_id = v_sheet.outlet_id
    limit 1
  ) sh on true
  left join lateral (
    select 1 as employee_id from callout_history
    where employee_id = tsr.employee_id and date = v_sheet.date limit 1
  ) co on true
  left join outlet_roles orl
    on orl.outlet_id = v_sheet.outlet_id
   and orl.position_name = coalesce(sh.position, emp.home_position, emp.position)
  where tsr.tip_sheet_id = p_tip_sheet_id;

  -- Reset all rows; eligible ones get recomputed below.
  update tip_sheet_rows set tip_amount = 0 where tip_sheet_id = p_tip_sheet_id;
  update tip_sheet_rows tsr set role = e.role from _ts_elig e where e.row_id = tsr.id;

  if v_mode = 'pool' then
    -- pool_total = summed SC + NC, minus the 5% (house+manager) pullback.
    -- (the 20% stays inside the declared SC already.)
    v_pool := v_sc + v_nc - v_pullback;

    -- Missing points for any contributing role -> refuse (rule 12).
    select array_agg(distinct role) into v_missing
      from _ts_elig where eff_hours > 0 and points is null;
    if v_missing is not null then
      raise exception 'Missing points config for position(s): %', array_to_string(v_missing, ', ');
    end if;

    select sum(eff_hours * points) into v_weight from _ts_elig where eff_hours > 0;
    if coalesce(v_weight, 0) = 0 then
      raise exception 'No eligible hours to distribute (no approved timecards for %)', v_sheet.date;
    end if;

    update tip_sheet_rows tsr
       set tip_amount = round(v_pool * (e.eff_hours * e.points) / v_weight, 2)
      from _ts_elig e
     where e.row_id = tsr.id and e.eff_hours > 0;

  else
    -- INDIVIDUAL mode. Support positions = roles with tip_out_pct set (they
    -- RECEIVE tip-outs). Servers = everyone else (they KEEP own SC+NC minus
    -- tip-outs). Each server tips out base*pct/100 to each support position's
    -- mini-pool; the large-party pullback is shared across servers by base.
    -- Simplifications (no prod individual config yet): tip-out base is the
    -- server's declared SC+NC regardless of tip_out_revenue_source; large-party
    -- 20% stays in the summed flow.

    -- total base of all servers (rows whose role has NO tip_out_pct) — used to
    -- share the large-party pullback across servers proportionally.
    select coalesce(sum(decl_sc + decl_nc), 0) into v_servers_base
      from _ts_elig where tip_out_pct is null;

    -- Missing points for any support position that must split a mini-pool -> refuse.
    select array_agg(distinct role) into v_missing
      from _ts_elig where tip_out_pct is not null and eff_hours > 0 and points is null;
    if v_missing is not null then
      raise exception 'Missing points config for support position(s): %', array_to_string(v_missing, ', ');
    end if;

    -- total tip-out % that every server owes (sum of all support positions' pct)
    -- Servers: tip_amount = base - base*(sum pct)/100 - pullback_share
    update tip_sheet_rows tsr
       set tip_amount = round(
             (e.decl_sc + e.decl_nc)
             - (e.decl_sc + e.decl_nc) * (select coalesce(sum(tip_out_pct),0) from _ts_elig where tip_out_pct is not null) / 100.0
             - case when v_servers_base > 0 then v_pullback * (e.decl_sc + e.decl_nc) / v_servers_base else 0 end
           , 2)
      from _ts_elig e
     where e.row_id = tsr.id and e.tip_out_pct is null;

    -- Each support position mini-pool = sum over servers of base*that_pct/100,
    -- distributed among that position's eligible employees by eff_hours*points.
    update tip_sheet_rows tsr
       set tip_amount = round(
             ( -- mini-pool dollars for this support position
               (select coalesce(sum(s.decl_sc + s.decl_nc),0) from _ts_elig s where s.tip_out_pct is null)
               * e.tip_out_pct / 100.0
             )
             * (e.eff_hours * e.points)
             / nullif((select sum(x.eff_hours * x.points) from _ts_elig x
                        where x.role = e.role and x.tip_out_pct is not null and x.eff_hours > 0), 0)
           , 2)
      from _ts_elig e
     where e.row_id = tsr.id and e.tip_out_pct is not null and e.eff_hours > 0;
  end if;

  update tip_sheets set status = 'ready' where id = p_tip_sheet_id;

  return jsonb_build_object(
    'tip_sheet_id', p_tip_sheet_id,
    'mode', v_mode,
    'status', 'ready',
    'pool_total', case when v_mode='pool' then v_pool else null end,
    'pullback', v_pullback,
    'distributed', (select coalesce(sum(tip_amount),0) from tip_sheet_rows where tip_sheet_id = p_tip_sheet_id)
  );
end;$$;


-- -------------------------------------------------------------------------
-- ts_post: lock a computed sheet. ready -> posted. Pay engine now reads it.
-- -------------------------------------------------------------------------
create or replace function ts_post(p_tip_sheet_id uuid)
returns jsonb
language plpgsql security definer as $$
declare v_status text;
begin
  select status into v_status from tip_sheets where id = p_tip_sheet_id;
  if v_status is null then raise exception 'Tip sheet % not found', p_tip_sheet_id; end if;
  if v_status <> 'ready' then raise exception 'Only a "ready" sheet can be posted (is %)', v_status; end if;
  update tip_sheets set status = 'posted' where id = p_tip_sheet_id;
  return jsonb_build_object('tip_sheet_id', p_tip_sheet_id, 'status', 'posted');
end;$$;


-- -------------------------------------------------------------------------
-- ts_unpost: posted -> pending. Refuses if payroll for the sheet's week has
-- already been posted (any posted timecard in the same calendar week).
-- -------------------------------------------------------------------------
create or replace function ts_unpost(p_tip_sheet_id uuid)
returns jsonb
language plpgsql security definer as $$
declare v_sheet tip_sheets%rowtype;
begin
  select * into v_sheet from tip_sheets where id = p_tip_sheet_id;
  if not found then raise exception 'Tip sheet % not found', p_tip_sheet_id; end if;
  if v_sheet.status <> 'posted' then raise exception 'Only a posted sheet can be reverted (is %)', v_sheet.status; end if;
  if exists (
    select 1 from timecards
    where status = 'posted' and date_trunc('week', date) = date_trunc('week', v_sheet.date)
  ) then
    raise exception 'Payroll already posted for this period — cannot revert';
  end if;
  update tip_sheets set status = 'pending' where id = p_tip_sheet_id;
  return jsonb_build_object('tip_sheet_id', p_tip_sheet_id, 'status', 'pending');
end;$$;


-- -------------------------------------------------------------------------
-- pay_breakdown (UPDATED): now reads tip_sheet_rows.tip_amount for posted/
-- approved tip sheets in the period. Supersedes the version in payroll.sql
-- (kept in sync there). Only the `tiprows` CTE + tip_rows_amount wiring +
-- the activity filter changed vs. the Tier 1 #2 version.
-- -------------------------------------------------------------------------
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
  tip_pay         numeric,
  gross_pay       numeric,
  has_missing_rate boolean,
  warnings        text[]
)
language sql stable as $$
  with mode as (select lower(coalesce(p_mode, 'actual')) as m),
  tc as (
    select employee_id, sum(regular_hours) as reg, sum(ot_hours) as ot,
           sum(training_hours) as trn, count(*) as approved_cnt
    from timecards
    where date between p_start and p_end and status in ('approved','posted')
    group by employee_id
  ),
  sh as (
    select s.employee_id, count(*) as sched_cnt,
           sum(case when exists (
                 select 1 from timecards t where t.shift_id = s.id and t.status in ('approved','posted')
               ) then 0
               else greatest(0, extract(epoch from (
                      (case when (s.date::text||' '||s.end_time::text)::timestamp
                                 <= (s.date::text||' '||s.start_time::text)::timestamp
                            then (s.date::text||' '||s.end_time::text)::timestamp + interval '1 day'
                            else (s.date::text||' '||s.end_time::text)::timestamp end)
                      - (s.date::text||' '||s.start_time::text)::timestamp)) / 3600.0)
               end) as proj_hours
    from shifts s
    where s.date between p_start and p_end and s.start_time is not null and s.end_time is not null
    group by s.employee_id
  ),
  pto as (
    select employee_id, sum(paid_hours) as pto_hours
    from pto_allocations where date between p_start and p_end group by employee_id
  ),
  mgr as (
    select lpr.manager_employee_id as employee_id, sum(lpr.manager_amount) as mgr_amt
    from large_party_revenues lpr
    join tip_sheets ts on ts.id = lpr.tip_sheet_id
    where ts.status in ('approved','posted') and ts.date between p_start and p_end
    group by lpr.manager_employee_id
  ),
  tiprows as (
    select tsr.employee_id, sum(tsr.tip_amount) as amt
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
      coalesce(b.ot_rate, b.regular_rate * 1.5) as ot_rate_eff
    from base b
  ),
  pays as (
    select c.*,
      case when c.reg_used = 0 then 0 when c.regular_rate is null then null
           else round(c.reg_used * c.regular_rate, 2) end as regular_pay,
      case when c.ot_hours = 0 then 0 when c.ot_rate_eff is null then null
           else round(c.ot_hours * c.ot_rate_eff, 2) end as ot_pay,
      case when c.training_hours = 0 then 0 when c.training_rate is null then null
           else round(c.training_hours * c.training_rate, 2) end as training_pay,
      case when c.pto_hours = 0 then 0 when c.pto_rate is null then null
           else round(c.pto_hours * c.pto_rate, 2) end as pto_pay,
      round(c.manager_amount + c.tip_rows_amount, 2) as tip_pay
    from calc c
  )
  select
    p.employee_id, p.first_name, p.last_name, p.title, p.department, p.job_position, p.outlet_name,
    p.reg_used as regular_hours,
    p.ot_hours, p.training_hours, p.pto_hours, p.projected_hours,
    p.approved_count, p.scheduled_count,
    p.regular_rate, p.ot_rate_eff as ot_rate_effective, p.training_rate, p.pto_rate,
    p.regular_pay, p.ot_pay, p.training_pay, p.pto_pay,
    p.manager_amount, p.tip_rows_amount, p.tip_pay,
    case when (p.regular_pay is null or p.ot_pay is null or p.training_pay is null or p.pto_pay is null)
         then null
         else round(coalesce(p.regular_pay,0) + coalesce(p.ot_pay,0)
                  + coalesce(p.training_pay,0) + coalesce(p.pto_pay,0) + p.tip_pay, 2)
    end as gross_pay,
    (p.regular_pay is null or p.ot_pay is null or p.training_pay is null or p.pto_pay is null) as has_missing_rate,
    array_remove(array[
      case when p.regular_pay is null then 'Missing regular_rate' end,
      case when p.ot_pay is null      then 'Missing ot_rate / regular_rate' end,
      case when p.training_pay is null then 'Missing training_rate' end,
      case when p.pto_pay is null     then 'Missing pto_rate' end
    ], null) as warnings
  from pays p
  order by p.first_name, p.last_name;
$$;

-- Expose the new/updated functions to PostgREST immediately.
notify pgrst, 'reload schema';

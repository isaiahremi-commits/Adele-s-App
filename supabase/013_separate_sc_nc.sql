-- =========================================================================
-- Migration 013 — separate service-charge vs non-cash tip distribution (Item 1).
-- Run in the Supabase SQL editor. Idempotent.
--
-- Adds tip_sheet_rows.sc_amount / nc_amount. The SC pool and NC pool now
-- distribute INDEPENDENTLY (same hours×points weighting). The large-party
-- house+manager pullback comes off the SC pool (large parties are service
-- charge). tip_amount is kept as (sc_amount + nc_amount) so the pay engine
-- (reads tip_amount) is unaffected. Math is otherwise unchanged.
-- =========================================================================

ALTER TABLE tip_sheet_rows ADD COLUMN IF NOT EXISTS sc_amount numeric(10,2);
ALTER TABLE tip_sheet_rows ADD COLUMN IF NOT EXISTS nc_amount numeric(10,2);

CREATE OR REPLACE FUNCTION ts_compute(p_tip_sheet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
declare
  v_sheet    tip_sheets%rowtype;
  v_mode     text;
  v_sc       numeric;
  v_nc       numeric;
  v_pullback numeric := 0;
  v_sc_pool  numeric;
  v_nc_pool  numeric;
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

  update tip_sheet_rows set tip_amount = 0, sc_amount = 0, nc_amount = 0 where tip_sheet_id = p_tip_sheet_id;
  update tip_sheet_rows tsr set role = e.role from _ts_elig e where e.row_id = tsr.id;

  if v_mode = 'pool' then
    -- SC pool (minus the house+manager pullback) and NC pool, distributed separately.
    v_sc_pool := v_sc - v_pullback;
    v_nc_pool := v_nc;

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
       set sc_amount  = round(v_sc_pool * (e.eff_hours * e.points) / v_weight, 2),
           nc_amount  = round(v_nc_pool * (e.eff_hours * e.points) / v_weight, 2),
           tip_amount = round(v_sc_pool * (e.eff_hours * e.points) / v_weight, 2)
                      + round(v_nc_pool * (e.eff_hours * e.points) / v_weight, 2)
      from _ts_elig e
     where e.row_id = tsr.id and e.eff_hours > 0;

  else
    -- INDIVIDUAL mode (unchanged tip_amount math); split sc/nc by each row's
    -- declared ratio (support rows = all SC).
    select coalesce(sum(decl_sc + decl_nc), 0) into v_servers_base
      from _ts_elig where tip_out_pct is null;

    select array_agg(distinct role) into v_missing
      from _ts_elig where tip_out_pct is not null and eff_hours > 0 and points is null;
    if v_missing is not null then
      raise exception 'Missing points config for support position(s): %', array_to_string(v_missing, ', ');
    end if;

    update tip_sheet_rows tsr
       set tip_amount = round(
             (e.decl_sc + e.decl_nc)
             - (e.decl_sc + e.decl_nc) * (select coalesce(sum(tip_out_pct),0) from _ts_elig where tip_out_pct is not null) / 100.0
             - case when v_servers_base > 0 then v_pullback * (e.decl_sc + e.decl_nc) / v_servers_base else 0 end
           , 2)
      from _ts_elig e
     where e.row_id = tsr.id and e.tip_out_pct is null;

    update tip_sheet_rows tsr
       set tip_amount = round(
             ((select coalesce(sum(s.decl_sc + s.decl_nc),0) from _ts_elig s where s.tip_out_pct is null)
               * e.tip_out_pct / 100.0)
             * (e.eff_hours * e.points)
             / nullif((select sum(x.eff_hours * x.points) from _ts_elig x
                        where x.role = e.role and x.tip_out_pct is not null and x.eff_hours > 0), 0)
           , 2)
      from _ts_elig e
     where e.row_id = tsr.id and e.tip_out_pct is not null and e.eff_hours > 0;

    -- derive sc/nc from tip_amount by declared ratio (support -> all SC)
    update tip_sheet_rows tsr
       set sc_amount = case when (e.decl_sc + e.decl_nc) > 0
                            then round(coalesce(tsr.tip_amount,0) * e.decl_sc / (e.decl_sc + e.decl_nc), 2)
                            else coalesce(tsr.tip_amount,0) end,
           nc_amount = coalesce(tsr.tip_amount,0)
                     - case when (e.decl_sc + e.decl_nc) > 0
                            then round(coalesce(tsr.tip_amount,0) * e.decl_sc / (e.decl_sc + e.decl_nc), 2)
                            else coalesce(tsr.tip_amount,0) end
      from _ts_elig e where e.row_id = tsr.id;
  end if;

  update tip_sheets set status = 'ready' where id = p_tip_sheet_id;

  return jsonb_build_object(
    'tip_sheet_id', p_tip_sheet_id,
    'mode', v_mode,
    'status', 'ready',
    'pullback', v_pullback,
    'sc_distributed', (select coalesce(sum(sc_amount),0) from tip_sheet_rows where tip_sheet_id = p_tip_sheet_id),
    'nc_distributed', (select coalesce(sum(nc_amount),0) from tip_sheet_rows where tip_sheet_id = p_tip_sheet_id),
    'distributed', (select coalesce(sum(tip_amount),0) from tip_sheet_rows where tip_sheet_id = p_tip_sheet_id)
  );
end;$$;

NOTIFY pgrst, 'reload schema';

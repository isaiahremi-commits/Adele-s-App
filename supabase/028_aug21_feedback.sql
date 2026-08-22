-- =========================================================================
-- Migration 028 (Phase 2, PR #29) — Aug 21 meeting feedback (DB slice).
--
-- Run in the Supabase SQL editor AFTER 027. Idempotent — safe to re-run.
-- One transaction: a failure anywhere rolls the whole migration back.
--
-- What this does (Adèle's Aug 21 meeting + Isaiah's UI notes):
--   1. tip_pool_mode: 'pool_daily' splits into TWO sub-modes —
--        · pool_daily_all      = the whole outlet-day pools as one unit
--                                (every shift's sheet together; everyone who
--                                worked that day at the outlet shares);
--        · pool_daily_separate = each shift's sheet pools on its own
--                                (AM pool ≠ PM pool — mechanically the
--                                pre-028 single-sheet compute, since sheets
--                                are generated per outlet+shift+date).
--      Existing 'pool_daily' rows migrate to 'pool_daily_all' (the safe
--      default per the meeting), and the CHECK expands to the 5 values:
--      pool_daily_all | pool_daily_separate | pool_weekly |
--      individual_daily | no_tips. NULL stays legal (027 stance).
--   2. Tip engine: re-created IN PLACE under whichever name holds it
--      (ts_compute_unguarded post-014, plain ts_compute pre-014), after
--      drift assertions — the 027 precedent. New body = 027's verbatim with:
--        · legacy-value normalization up front ('pool'/'pool_daily' →
--          pool_daily_all, 'individual' → individual_daily);
--        · pool_daily_all computes the whole outlet-day as one unit (the
--          pool_weekly machinery keyed on date instead of week): SC/NC and
--          large-party pullback aggregate across every sheet of the day,
--          all pending/ready sheets of the day move to 'ready' together,
--          and the compute REFUSES if any sheet of the day is posted;
--        · pool_daily_all dedupes an employee who appears on more than one
--          of the day's sheets (timecard hours are per-DAY — two rows would
--          double their weight): the weight rides one row, the others zero;
--        · pool_daily_separate keeps the single-sheet daily math unchanged.
--   3. outlet_upsert: re-created with the 5-value mode validation; new
--      outlets default to 'pool_daily_all'.
--   4. Establishment lock: setup.setup_locked_at TIMESTAMPTZ + a BEFORE
--      trigger. Once locked, changing company_name or pay_cycle raises
--      "Establishment is locked. Contact your Manadele admin to unlock."
--      (every write path — UI PATCH, RPC, SQL — goes through the trigger).
--      The lock engages on the first save that carries a real (non-empty)
--      company_name; existing configured rows are backfilled locked NOW.
--      period_start_day and the threshold columns stay editable.
--      Admin unlock = UPDATE setup SET setup_locked_at = NULL (allowed —
--      the trigger only blocks name/cycle changes while locked; the next
--      ordinary save re-locks).
--   5. employees.employment_type ('full_time' | 'part_time' | 'seasonal',
--      NOT NULL, backfilled 'full_time') + seasonal_start_date /
--      seasonal_end_date (nullable, end ≥ start when both set).
--   6. employee_tip_totals_ytd(): manager-guarded YTD tip totals per
--      employee for the web Employees page. The old /api/employees/totals
--      read the DEAD tip_allocations table (nothing writes it since the
--      Tier-1 engine) with no date bound AND no pagination — this RPC is
--      the honest replacement: tip_sheet_rows × approved/posted sheets,
--      Jan 1 → today, grouped in SQL (026's filters, tenant-wide).
--
-- Sheet GENERATION is untouched — sheets stay per (outlet, shift, date);
-- pool_daily_all only changes how they COMPUTE. tip_declaration_submit /
-- tip_declaration_for_me need no change (no_tips handling is mode-value
-- agnostic; the new values pass through as data).
-- =========================================================================

BEGIN;

-- ── Phase 0: prerequisites fail-fast ─────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.tenants') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — tenants missing; apply 005 first';
  END IF;
  IF to_regprocedure('public.current_tenant_id()') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — current_tenant_id() missing; apply 005 first';
  END IF;
  IF coalesce(to_regprocedure('public.ts_compute_unguarded(uuid)'),
              to_regprocedure('public.ts_compute(uuid)')) IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — tip engine not found; apply tip_sheet.sql / 019 first';
  END IF;
  IF to_regprocedure('public.outlet_upsert(uuid, text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — outlet_upsert missing; apply 027 first';
  END IF;
  IF to_regclass('public.setup') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — setup table missing; apply schema.sql first';
  END IF;
END $$;

-- ── Phase 1: tip_pool_mode — value migration + 5-value CHECK ─────────────
-- 027's 4-value CHECK must come off BEFORE the rewrite — 'pool_daily_all'
-- isn't in its list, so updating under it aborts. (Caught in PGlite.)
ALTER TABLE outlets DROP CONSTRAINT IF EXISTS outlets_tip_pool_mode_check;

-- Legacy literals ('pool'/'individual') can only exist on a chain that
-- skipped 027's rewrite; folding them here costs nothing.
UPDATE outlets SET tip_pool_mode = lower(btrim(tip_pool_mode))
WHERE tip_pool_mode IS NOT NULL AND tip_pool_mode <> lower(btrim(tip_pool_mode));
UPDATE outlets SET tip_pool_mode = 'pool_daily_all'
WHERE tip_pool_mode IN ('pool', 'pool_daily');
UPDATE outlets SET tip_pool_mode = 'individual_daily' WHERE tip_pool_mode = 'individual';

-- Any value outside the 5 new ones (NULL stays legal) aborts loudly rather
-- than being silently rewritten.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT tip_pool_mode, ', ') INTO bad FROM outlets
  WHERE tip_pool_mode IS NOT NULL
    AND tip_pool_mode NOT IN ('pool_daily_all','pool_daily_separate','pool_weekly',
                              'individual_daily','no_tips');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — unexpected tip_pool_mode value(s): %. Fix by hand, then re-run.', bad;
  END IF;
END $$;

ALTER TABLE outlets ADD CONSTRAINT outlets_tip_pool_mode_check
  CHECK (tip_pool_mode IN ('pool_daily_all','pool_daily_separate','pool_weekly',
                           'individual_daily','no_tips'));

-- ── Phase 2: tip engine — 5-mode ts_compute (in place, shim-aware) ───────
DO $eng$
DECLARE
  v_target regprocedure;
  v_name   text;
  v_def    text;
  v_body   text;
BEGIN
  -- Post-014 the body lives in ts_compute_unguarded (ts_compute is the
  -- guard shim); pre-014 chains hold it in ts_compute itself.
  v_target := coalesce(to_regprocedure('public.ts_compute_unguarded(uuid)'),
                       to_regprocedure('public.ts_compute(uuid)'));
  v_def := pg_get_functiondef(v_target);
  IF position('_ts_elig' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — % is not the tip engine (no _ts_elig); refusing to replace', v_target;
  END IF;
  -- Expect the 027 body (sentinel: pool_weekly) or an earlier 028 run
  -- (sentinel: pool_daily_separate). Anything else drifted — review first.
  IF position('pool_weekly' IN v_def) = 0
     AND position('pool_daily_separate' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — % body is neither the 027 engine nor 028''s; live body drifted, patch by hand', v_target;
  END IF;

  v_name := CASE WHEN v_target = to_regprocedure('public.ts_compute_unguarded(uuid)')
                 THEN 'ts_compute_unguarded' ELSE 'ts_compute' END;

  v_body := $ts028$
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
  -- 027: the compute set — one sheet (single-sheet modes), the outlet's
  -- week (pool_weekly), or — 028 — the outlet's day (pool_daily_all).
  v_week_start date;
  v_sheet_ids  uuid[];
  v_posted     int := 0;
begin
  select * into v_sheet from tip_sheets where id = p_tip_sheet_id;
  if not found then raise exception 'Tip sheet % not found', p_tip_sheet_id; end if;
  if v_sheet.status not in ('pending','ready') then
    raise exception 'Cannot compute a % tip sheet', v_sheet.status;
  end if;
  if v_sheet.outlet_id is null then raise exception 'Tip sheet has no outlet'; end if;

  select tip_pool_mode into v_mode from outlets where id = v_sheet.outlet_id;
  if v_mode is null then raise exception 'Outlet has no tip_pool_mode configured'; end if;

  -- 028: normalize legacy literals up front (027/028 rewrote stored rows;
  -- this is belt-and-braces for a not-yet-migrated outlet).
  if v_mode in ('pool', 'pool_daily') then v_mode := 'pool_daily_all'; end if;
  if v_mode = 'individual' then v_mode := 'individual_daily'; end if;

  -- 027: no-tips outlets never distribute — return the marker, touch nothing.
  if v_mode = 'no_tips' then
    return jsonb_build_object(
      'tip_sheet_id', p_tip_sheet_id,
      'mode', 'no_tips',
      'status', v_sheet.status,
      'skipped', true,
      'message', 'no tips at this outlet');
  end if;

  -- 027: unknown modes raise (never silently compute as individual).
  if v_mode not in ('pool_daily_all','pool_daily_separate','pool_weekly','individual_daily') then
    raise exception 'Unknown tip_pool_mode "%" — expected pool_daily_all, pool_daily_separate, pool_weekly, individual_daily or no_tips', v_mode;
  end if;

  if v_mode = 'pool_weekly' then
    -- The whole outlet-week computes as one unit. week_start stamped by the
    -- approve flow wins; unstamped sheets fall back to the date's Sunday
    -- (the scheduling grid is Sunday-first).
    v_week_start := coalesce(v_sheet.week_start,
                             v_sheet.date - extract(dow from v_sheet.date)::int);
    select count(*) filter (where status = 'posted'),
           array_agg(id) filter (where status in ('pending','ready'))
      into v_posted, v_sheet_ids
      from tip_sheets
     where outlet_id = v_sheet.outlet_id
       and tenant_id = v_sheet.tenant_id
       and coalesce(week_start, date - extract(dow from date)::int) = v_week_start;
    if v_posted > 0 then
      raise exception 'Weekly-pool weeks compute as one unit — % sheet(s) of this week are already posted. Revert them (ts_unpost) and recompute the week.', v_posted;
    end if;
  elsif v_mode = 'pool_daily_all' then
    -- 028: the whole outlet-day computes as one unit — every shift's sheet
    -- of the date together (the weekly machinery, keyed on the date).
    select count(*) filter (where status = 'posted'),
           array_agg(id) filter (where status in ('pending','ready'))
      into v_posted, v_sheet_ids
      from tip_sheets
     where outlet_id = v_sheet.outlet_id
       and tenant_id = v_sheet.tenant_id
       and date = v_sheet.date;
    if v_posted > 0 then
      raise exception 'Daily-pool (all shifts) days compute as one unit — % sheet(s) of this day are already posted. Revert them (ts_unpost) and recompute the day.', v_posted;
    end if;
  else
    v_sheet_ids := array[p_tip_sheet_id];
  end if;

  -- LOCKED large-party split off party revenue: 20% pool / 3% house /
  -- 2% manager — across the whole compute set.
  update large_party_revenues
     set pool_amount    = round(revenue * 0.20, 2),
         house_amount   = round(revenue * 0.03, 2),
         manager_amount = round(revenue * 0.02, 2)
   where tip_sheet_id = any(v_sheet_ids);
  select coalesce(sum(house_amount + manager_amount), 0) into v_pullback
    from large_party_revenues where tip_sheet_id = any(v_sheet_ids);

  -- Declared sheet-level totals — one sheet, or the whole day/week summed.
  select coalesce(sum(coalesce(service_charge, 0)), 0),
         coalesce(sum(coalesce(non_cash_tips, 0)), 0)
    into v_sc, v_nc
    from tip_sheets where id = any(v_sheet_ids);

  -- Eligibility: rows across the compute set; hours/PTO/position/callout
  -- resolve against each row's OWN sheet date (tsx), which matters for the
  -- weekly set. Position match stays case-insensitive (019).
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
  join tip_sheets tsx on tsx.id = tsr.tip_sheet_id
  join employees emp on emp.id = tsr.employee_id
  left join lateral (
    select sum(regular_hours + ot_hours) as h from timecards
    where employee_id = tsr.employee_id and date = tsx.date and status in ('approved','posted')
  ) tc on true
  left join lateral (
    select sum(paid_hours) as pto from pto_allocations
    where employee_id = tsr.employee_id and date = tsx.date
  ) pt on true
  left join lateral (
    select position from shifts
    where employee_id = tsr.employee_id and date = tsx.date and outlet_id = tsx.outlet_id
    limit 1
  ) sh on true
  left join lateral (
    select 1 as employee_id from callout_history
    where employee_id = tsr.employee_id and date = tsx.date limit 1
  ) co on true
  left join outlet_roles orl
    on orl.outlet_id = tsx.outlet_id
   and lower(orl.position_name) = lower(coalesce(sh.position, emp.home_position, emp.position))
  where tsr.tip_sheet_id = any(v_sheet_ids)
    -- 019: salaried employees sit out the distribution entirely
    -- (pay-type driven; outlet_roles.is_tipped no longer consulted).
    and coalesce(emp.pay_type, 'hourly') <> 'salary';

  -- 028 pool_daily_all: an employee on more than one of the day's sheets
  -- (an AM + PM double) would double-count their per-DAY timecard hours —
  -- keep the weight on one row, zero the rest. Their whole day's share
  -- lands on the surviving row; the reset below zeroes the others.
  if v_mode = 'pool_daily_all' then
    update _ts_elig e
       set eff_hours = 0
     where e.row_id <> (select e2.row_id from _ts_elig e2
                         where e2.employee_id = e.employee_id
                         order by e2.row_id limit 1);
  end if;

  update tip_sheet_rows set tip_amount = 0, sc_amount = 0, nc_amount = 0
   where tip_sheet_id = any(v_sheet_ids);
  update tip_sheet_rows tsr set role = e.role from _ts_elig e where e.row_id = tsr.id;

  if v_mode in ('pool_daily_all','pool_daily_separate','pool_weekly') then
    -- SC pool (minus the house+manager pullback) and NC pool, distributed
    -- separately by eff_hours × points — per sheet, per day, or per week.
    v_sc_pool := v_sc - v_pullback;
    v_nc_pool := v_nc;

    select array_agg(distinct role) into v_missing
      from _ts_elig where eff_hours > 0 and points is null;
    if v_missing is not null then
      raise exception 'Missing points config for position(s): %', array_to_string(v_missing, ', ');
    end if;

    select sum(eff_hours * points) into v_weight from _ts_elig where eff_hours > 0;
    if coalesce(v_weight, 0) = 0 then
      raise exception 'No eligible hours to distribute (no approved timecards for %)',
        case when v_mode = 'pool_weekly'
             then 'the week of ' || v_week_start::text
             else v_sheet.date::text end;
    end if;

    update tip_sheet_rows tsr
       set sc_amount  = round(v_sc_pool * (e.eff_hours * e.points) / v_weight, 2),
           nc_amount  = round(v_nc_pool * (e.eff_hours * e.points) / v_weight, 2),
           tip_amount = round(v_sc_pool * (e.eff_hours * e.points) / v_weight, 2)
                      + round(v_nc_pool * (e.eff_hours * e.points) / v_weight, 2)
      from _ts_elig e
     where e.row_id = tsr.id and e.eff_hours > 0;

  else
    -- INDIVIDUAL mode (individual_daily; always a single sheet). Unchanged
    -- 013/019 math; sc/nc split by each row's declared ratio.
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

  update tip_sheets set status = 'ready' where id = any(v_sheet_ids);

  return jsonb_build_object(
    'tip_sheet_id', p_tip_sheet_id,
    'mode', v_mode,
    'status', 'ready',
    'pullback', v_pullback,
    'week_start', case when v_mode = 'pool_weekly' then to_jsonb(v_week_start) else 'null'::jsonb end,
    'sheets_computed', coalesce(array_length(v_sheet_ids, 1), 0),
    'sc_distributed', (select coalesce(sum(sc_amount),0) from tip_sheet_rows where tip_sheet_id = any(v_sheet_ids)),
    'nc_distributed', (select coalesce(sum(nc_amount),0) from tip_sheet_rows where tip_sheet_id = any(v_sheet_ids)),
    'distributed', (select coalesce(sum(tip_amount),0) from tip_sheet_rows where tip_sheet_id = any(v_sheet_ids))
  );
end;$ts028$;

  -- CREATE OR REPLACE keeps ownership + ACLs (unguarded stays revoked from
  -- authenticated per 014; the shim keeps delegating).
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.%I(p_tip_sheet_id uuid) RETURNS jsonb
     LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L',
    v_name, v_body);
END $eng$;

-- ── Phase 3: outlet_upsert — 5-mode validation, default pool_daily_all ───
-- 027's body verbatim except the mode list and the insert default.
DROP FUNCTION IF EXISTS public.outlet_upsert(uuid, text, text, uuid);
CREATE FUNCTION public.outlet_upsert(
  p_department_id uuid,
  p_name text,
  p_tip_pool_mode text DEFAULT NULL,
  p_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
  v_mode text := nullif(lower(btrim(coalesce(p_tip_pool_mode, ''))), '');
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant on your session'; END IF;
  IF NOT public.is_restaurant_manager() THEN RAISE EXCEPTION 'Managers only'; END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Outlet name is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM departments d WHERE d.id = p_department_id AND d.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Department not found';
  END IF;
  IF v_mode IS NOT NULL
     AND v_mode NOT IN ('pool_daily_all','pool_daily_separate','pool_weekly',
                        'individual_daily','no_tips') THEN
    RAISE EXCEPTION 'Invalid tip_pool_mode "%" — expected pool_daily_all, pool_daily_separate, pool_weekly, individual_daily or no_tips', v_mode;
  END IF;
  IF EXISTS (
    SELECT 1 FROM outlets o
    WHERE o.tenant_id = v_tenant
      AND lower(btrim(o.name)) = lower(btrim(p_name))
      AND (p_id IS NULL OR o.id <> p_id)
  ) THEN
    RAISE EXCEPTION 'An outlet named "%" already exists', btrim(p_name);
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO outlets (tenant_id, department_id, name, tip_pool_mode)
    VALUES (v_tenant, p_department_id, btrim(p_name), coalesce(v_mode, 'pool_daily_all'))
    RETURNING id INTO v_id;
  ELSE
    UPDATE outlets
       SET name = btrim(p_name),
           department_id = p_department_id,
           tip_pool_mode = coalesce(v_mode, tip_pool_mode)
     WHERE id = p_id AND tenant_id = v_tenant
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Outlet not found'; END IF;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.outlet_upsert(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.outlet_upsert(uuid, text, text, uuid) TO authenticated;

-- ── Phase 4: Establishment lock — setup_locked_at + guard trigger ────────
-- Fresh chains: schema.sql's setup predates company_name — heal it so the
-- trigger and backfill below always have the column (no-op on live).
ALTER TABLE setup ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE setup ADD COLUMN IF NOT EXISTS setup_locked_at timestamptz;

-- Backfill: a row that already carries a real establishment name IS
-- configured — lock it now (Adèle's live tenant). Rows without a name stay
-- unlocked (locking them would brick first-time setup).
UPDATE setup SET setup_locked_at = now()
WHERE setup_locked_at IS NULL
  AND company_name IS NOT NULL AND btrim(company_name) <> '';

CREATE OR REPLACE FUNCTION public.setup_lock_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.setup_locked_at IS NOT NULL THEN
    -- Locked: only company_name + pay_cycle are frozen; everything else
    -- (period_start_day, thresholds, SMS settings…) stays editable. An
    -- explicit UPDATE of setup_locked_at itself (the admin unlock) passes.
    IF NEW.company_name IS DISTINCT FROM OLD.company_name
       OR NEW.pay_cycle IS DISTINCT FROM OLD.pay_cycle THEN
      RAISE EXCEPTION 'Establishment is locked. Contact your Manadele admin to unlock.';
    END IF;
    RETURN NEW;
  END IF;
  -- Unlocked (or INSERT): the first save carrying a real name locks.
  IF NEW.setup_locked_at IS NULL
     AND NEW.company_name IS NOT NULL AND btrim(NEW.company_name) <> '' THEN
    NEW.setup_locked_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_setup_lock_guard ON setup;
CREATE TRIGGER trg_setup_lock_guard
  BEFORE INSERT OR UPDATE ON setup
  FOR EACH ROW EXECUTE FUNCTION public.setup_lock_guard();

-- ── Phase 5: employees.employment_type + seasonal dates ──────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_type text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS seasonal_start_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS seasonal_end_date date;

UPDATE employees SET employment_type = 'full_time' WHERE employment_type IS NULL;
ALTER TABLE employees ALTER COLUMN employment_type SET DEFAULT 'full_time';
ALTER TABLE employees ALTER COLUMN employment_type SET NOT NULL;

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_employment_type_check;
ALTER TABLE employees ADD CONSTRAINT employees_employment_type_check
  CHECK (employment_type IN ('full_time','part_time','seasonal'));
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_seasonal_dates_check;
ALTER TABLE employees ADD CONSTRAINT employees_seasonal_dates_check
  CHECK (seasonal_start_date IS NULL OR seasonal_end_date IS NULL
         OR seasonal_end_date >= seasonal_start_date);

-- ── Phase 6: employee_tip_totals_ytd — web Employees YTD card ────────────
-- Manager-guarded (024 idiom), SECURITY DEFINER ⇒ tenant-scoped explicitly.
-- Filters mirror 026's pay_ytd_for_me: approved/posted sheets, Jan 1 →
-- today, by sheet date. Grouped in SQL — no PostgREST row-cap truncation.
DROP FUNCTION IF EXISTS public.employee_tip_totals_ytd();
CREATE FUNCTION public.employee_tip_totals_ytd()
RETURNS TABLE (employee_id uuid, total_tips numeric, total_sc numeric, total_nc numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  y_start date := date_trunc('year', current_date)::date;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant on your session'; END IF;
  IF NOT public.is_restaurant_manager() THEN RAISE EXCEPTION 'Managers only'; END IF;
  RETURN QUERY
  SELECT tsr.employee_id,
         round(coalesce(sum(coalesce(tsr.tip_amount, 0)), 0), 2),
         round(coalesce(sum(coalesce(tsr.sc_amount, 0)), 0), 2),
         round(coalesce(sum(coalesce(tsr.nc_amount, 0)), 0), 2)
  FROM tip_sheet_rows tsr
  JOIN tip_sheets ts ON ts.id = tsr.tip_sheet_id
  WHERE ts.tenant_id = v_tenant
    AND ts.status IN ('approved','posted')
    AND ts.date >= y_start AND ts.date <= current_date
    AND tsr.employee_id IS NOT NULL
  GROUP BY tsr.employee_id;
END;
$$;

REVOKE ALL ON FUNCTION public.employee_tip_totals_ytd() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_tip_totals_ytd() TO authenticated;

-- ── Phase 7: final assertions ────────────────────────────────────────────
DO $$
DECLARE
  v_def text;
  v_target regprocedure;
BEGIN
  -- 7a. The engine speaks all five modes.
  v_target := coalesce(to_regprocedure('public.ts_compute_unguarded(uuid)'),
                       to_regprocedure('public.ts_compute(uuid)'));
  v_def := pg_get_functiondef(v_target);
  IF position('pool_daily_all' IN v_def) = 0
     OR position('pool_daily_separate' IN v_def) = 0
     OR position('pool_weekly' IN v_def) = 0
     OR position('no_tips' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — % lacks the 028 modes', v_target;
  END IF;

  -- 7b. The CHECK carries the 5 values.
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
  WHERE conname = 'outlets_tip_pool_mode_check' AND conrelid = 'public.outlets'::regclass;
  IF v_def IS NULL OR position('pool_daily_separate' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — outlets_tip_pool_mode_check not the 028 shape';
  END IF;

  -- 7c. outlet_upsert validates + defaults the new modes.
  v_def := pg_get_functiondef(to_regprocedure('public.outlet_upsert(uuid, text, text, uuid)'));
  IF position('pool_daily_all' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — outlet_upsert not 028-aware';
  END IF;

  -- 7d. Establishment lock in place.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'setup'
                   AND column_name = 'setup_locked_at') THEN
    RAISE EXCEPTION 'ASSERTION FAILED — setup.setup_locked_at missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgname = 'trg_setup_lock_guard'
                   AND tgrelid = 'public.setup'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ASSERTION FAILED — trg_setup_lock_guard missing';
  END IF;

  -- 7e. Employment type columns + constraints.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'employees'
                   AND column_name = 'employment_type' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'ASSERTION FAILED — employees.employment_type missing or nullable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'employees_employment_type_check'
                   AND conrelid = 'public.employees'::regclass) THEN
    RAISE EXCEPTION 'ASSERTION FAILED — employees_employment_type_check missing';
  END IF;

  -- 7f. YTD totals RPC exists with the right grants.
  IF to_regprocedure('public.employee_tip_totals_ytd()') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — employee_tip_totals_ytd missing';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.employee_tip_totals_ytd()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.employee_tip_totals_ytd()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED — employee_tip_totals_ytd grants wrong';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run as-is after the COMMIT) ────────────────────────────
-- 1. Mode distribution — only the five new values (or NULL) may appear.
SELECT coalesce(tip_pool_mode, '(null)') AS mode, count(*)
FROM outlets GROUP BY 1 ORDER BY 1;

-- 2. Engine spot-checks.
SELECT proname,
       position('pool_daily_all' IN pg_get_functiondef(oid)) > 0      AS has_daily_all,
       position('pool_daily_separate' IN pg_get_functiondef(oid)) > 0 AS has_daily_separate
FROM pg_proc
WHERE proname IN ('ts_compute_unguarded', 'ts_compute')
  AND pronamespace = 'public'::regnamespace;

-- 3. Lock state — configured rows show a timestamp.
SELECT id, company_name, pay_cycle, setup_locked_at FROM setup;

-- 4. Employment type distribution.
SELECT employment_type, count(*) FROM employees GROUP BY 1;

-- ── Rollback (run by hand only — restores the pre-028 posture) ───────────
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_setup_lock_guard ON setup;
-- DROP FUNCTION IF EXISTS public.setup_lock_guard();
-- ALTER TABLE setup DROP COLUMN IF EXISTS setup_locked_at;
-- DROP FUNCTION IF EXISTS public.employee_tip_totals_ytd();
-- ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_employment_type_check;
-- ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_seasonal_dates_check;
-- ALTER TABLE employees DROP COLUMN IF EXISTS employment_type;
-- ALTER TABLE employees DROP COLUMN IF EXISTS seasonal_start_date;
-- ALTER TABLE employees DROP COLUMN IF EXISTS seasonal_end_date;
-- ALTER TABLE outlets DROP CONSTRAINT IF EXISTS outlets_tip_pool_mode_check;
-- UPDATE outlets SET tip_pool_mode = 'pool_daily'
--   WHERE tip_pool_mode IN ('pool_daily_all','pool_daily_separate');
-- ALTER TABLE outlets ADD CONSTRAINT outlets_tip_pool_mode_check
--   CHECK (tip_pool_mode IN ('pool_daily','pool_weekly','individual_daily','no_tips'));
-- -- Re-run 027's Phase 7 (engine) + Phase 11 outlet_upsert to restore the
-- -- 4-mode engine + RPC validation.
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';

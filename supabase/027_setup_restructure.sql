-- =========================================================================
-- Migration 027 (Phase 2, PR #28) — Setup restructure:
-- Establishment → Departments → Outlets.
--
-- Run in the Supabase SQL editor. Idempotent — safe to re-run. One
-- transaction: a failure anywhere rolls the whole migration back.
--
-- What this does (Adèle's Aug 20 Dialpad spec):
--   1. Promotes `departments` to a first-class tenant-scoped table.
--      The table already exists (Phase 1: id, name, created_at, plus the
--      out-of-band type / tip_pool_strategy columns) but is tenant-agnostic
--      with 004b's untenanted manager policy. This adds tenant_id +
--      updated_at, backfills, dedupes case-insensitively, and rewrites RLS
--      (manager_full_access tenant-scoped + tenant_member_select, the
--      outlet_pars posture from 024).
--   2. New `department_positions` catalog: the positions a department owns.
--      Adèle's model is "departments have positions + optional outlets";
--      outlet_roles remains the per-outlet ASSIGNMENT of a department
--      position (with points). The outlet page's checkbox list reads this
--      catalog. Backfilled from outlet_roles + employee_outlets names.
--   3. Backfills departments from distinct employees.department text values,
--      links employees.department_id (column already exists), then infers
--      each outlet's department from its most-common employee (via
--      employees × shifts), falling back to the tenant's first department
--      alphabetically. A 'General' department is seeded for any tenant that
--      has outlets but no departments at all. Then outlets.department_id
--      SET NOT NULL. employees.department (text) is KEPT read-only for
--      legacy display — removal is PR #29 after verification.
--   4. tip_pool_mode expands to 4 values with a CHECK:
--      pool_daily | pool_weekly | individual_daily | no_tips.
--      Existing 'pool' → 'pool_daily', 'individual' → 'individual_daily'.
--      NULL stays legal (legacy unconfigured outlets keep raising in the
--      engine exactly as before; the new Setup UI always sets a mode).
--   5. Tip engine: the REAL body lives in ts_compute_unguarded post-014
--      (public.ts_compute is the guard shim — replacing it directly would
--      destroy the guard). The engine is re-created IN PLACE under whichever
--      name holds it (unguarded on prod, plain ts_compute on a pre-014
--      chain), after drift assertions. New body = the live 019 body
--      (incl. the 019-P2 salary guard) with three changes:
--        · no_tips → early return with a "no tips at this outlet" marker,
--          nothing touched;
--        · pool_daily (and legacy 'pool') → existing daily pool math;
--          individual_daily (and legacy 'individual') → existing individual
--          math; any OTHER non-null value now raises instead of silently
--          computing as individual (the old else-catch-all);
--        · pool_weekly → the whole outlet-week computes as ONE unit:
--          SC + NC and large-party pullback aggregate across every sheet of
--          the outlet's week (week_start stamped by the approve flow wins;
--          unstamped sheets fall back to the date's Sunday, matching the
--          scheduling grid), weights = eff_hours × points across the week,
--          every pending/ready sheet in the week recomputes and moves to
--          'ready' together. If any sheet of the week is already posted the
--          compute REFUSES (revert first) — a weekly pool can't be split
--          around a locked day.
--      A full re-create (not a string patch) is used here deliberately: the
--      weekly mode restructures the eligibility temp table, which is beyond
--      safe pg_get_functiondef surgery. 013 and 019 set the precedent of
--      full engine redefines; drift assertions below refuse to clobber an
--      unrecognized body.
--   6. pg_get_functiondef targeted patches (the 016/017 pattern) where the
--      change IS small:
--        · tip_declaration_submit — refuses for no_tips outlets;
--        · pay_breakdown — restores 014's tenant filter on the two `setup`
--          pay-cycle reads that 023 accidentally reverted (cross-tenant
--          read under pay_breakdown_for_me's SECURITY DEFINER delegation).
--      pay_breakdown needs NO no_tips change: employees at no-tips outlets
--      simply have no tip_sheet_rows, so tip_rows_amount is already $0
--      (verified in the PGlite harness).
--   7. tip_declaration_for_me gains a tip_pool_mode return column (mobile
--      shows "This outlet doesn't track tips" defensively). Return-shape
--      change ⇒ DROP + re-create + re-grant.
--   8. New manager-guarded SECURITY DEFINER RPCs (guard idiom of 024, every
--      statement explicitly tenant-scoped): department_upsert,
--      department_delete, department_list, department_position_add,
--      department_position_remove, outlet_upsert, outlet_assign_position,
--      outlet_unassign_position, outlet_list_for_department, outlet_detail.
--      NOTE: the PR spec wrote e.g. department_upsert(p_id DEFAULT NULL,
--      p_name) — Postgres requires defaulted params LAST, so the optional
--      p_id sits at the end of each signature.
--
-- Companion change (same PR): supabase/005_multi_tenant.sql gains
-- 'departments' + 'department_positions' in _tenant_tables (REV 6) so a 005
-- re-run stays consistent and assertion 3 doesn't trip. THIS file does the
-- actual column/backfill/policy work standalone — applying 027 alone
-- suffices (the 015/024 precedent).
--
-- Sheet GENERATION for no_tips outlets is skipped in the web approve route
-- (app/api/schedule/approve/route.ts) — generation lives in TS, not SQL.
-- With no sheets generated, manager_approval_inbox needs no change (nothing
-- pending from no-tips outlets) and mobile tip history is naturally empty.
-- =========================================================================

BEGIN;

-- ── Phase 0: prerequisites fail-fast ─────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.tenants') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — tenants missing; apply 005 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'outlets'
                   AND column_name = 'tip_pool_mode') THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — outlets.tip_pool_mode missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'employees'
                   AND column_name = 'department_id') THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — employees.department_id missing';
  END IF;
  IF to_regprocedure('public.current_tenant_id()') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — current_tenant_id() missing; apply 005 first';
  END IF;
  IF coalesce(to_regprocedure('public.ts_compute_unguarded(uuid)'),
              to_regprocedure('public.ts_compute(uuid)')) IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — tip engine not found; apply tip_sheet.sql / 019 first';
  END IF;
END $$;

-- ── Phase 1: departments — tenant promotion ──────────────────────────────
-- Fresh-DB guard (live DBs already have the table from Phase 1).
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE departments ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE departments ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Live DBs carry these two from the Phase 1 UI (FOH/BOH chip + strategy);
-- fresh chains need them so SELECT * consumers and department_list agree.
ALTER TABLE departments ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS tip_pool_strategy text;

-- Legacy rows predate tenancy → Adele Pilot, the 005 backfill convention.
UPDATE departments SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;
ALTER TABLE departments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE departments ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
CREATE INDEX IF NOT EXISTS departments_tenant_id_idx ON departments (tenant_id);

-- Dedupe before the unique index: same tenant + same lower(btrim(name)) —
-- keep the oldest row, repoint employees + outlets, delete the rest.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT d.id AS dupe_id, k.keep_id
    FROM departments d
    JOIN (
      SELECT tenant_id, lower(btrim(name)) AS lname,
             (array_agg(id ORDER BY created_at NULLS LAST, id))[1] AS keep_id
      FROM departments
      GROUP BY tenant_id, lower(btrim(name))
      HAVING count(*) > 1
    ) k ON k.tenant_id = d.tenant_id AND k.lname = lower(btrim(d.name))
    WHERE d.id <> k.keep_id
  LOOP
    UPDATE employees SET department_id = r.keep_id WHERE department_id = r.dupe_id;
    UPDATE outlets   SET department_id = r.keep_id WHERE department_id = r.dupe_id;
    DELETE FROM departments WHERE id = r.dupe_id;
    RAISE NOTICE 'departments: merged duplicate % into %', r.dupe_id, r.keep_id;
  END LOOP;
END $$;

-- Case-insensitive uniqueness (the 019 casing lesson — a plain UNIQUE
-- (tenant_id, name) would still allow 'Kitchen' vs 'kitchen').
CREATE UNIQUE INDEX IF NOT EXISTS departments_tenant_lower_name_uniq
  ON departments (tenant_id, lower(btrim(name)));

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON departments;
CREATE POLICY manager_full_access ON departments FOR ALL TO authenticated
  USING (public.is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_restaurant_manager() AND tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS tenant_member_select ON departments;
CREATE POLICY tenant_member_select ON departments FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- ── Phase 2: department_positions — the department's position catalog ────
CREATE TABLE IF NOT EXISTS department_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES tenants(id),
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  position_name text NOT NULL CHECK (btrim(position_name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS department_positions_dept_lower_name_uniq
  ON department_positions (department_id, lower(btrim(position_name)));
CREATE INDEX IF NOT EXISTS department_positions_tenant_id_idx
  ON department_positions (tenant_id);

ALTER TABLE department_positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON department_positions;
CREATE POLICY manager_full_access ON department_positions FOR ALL TO authenticated
  USING (public.is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_restaurant_manager() AND tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS tenant_member_select ON department_positions;
CREATE POLICY tenant_member_select ON department_positions FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- ── Phase 3: departments from employees.department text + linking ────────
-- New department rows for any (tenant, department-text) pair with no
-- case-insensitive match. Original casing of the text value is kept.
INSERT INTO departments (tenant_id, name)
SELECT DISTINCT ON (e.tenant_id, lower(btrim(e.department)))
       e.tenant_id, btrim(e.department)
FROM employees e
WHERE e.department IS NOT NULL AND btrim(e.department) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM departments d
    WHERE d.tenant_id = e.tenant_id
      AND lower(btrim(d.name)) = lower(btrim(e.department))
  )
ORDER BY e.tenant_id, lower(btrim(e.department)), e.created_at NULLS LAST;

-- Link employees whose department_id is still NULL. Rows already linked
-- (the employees wizard writes department_id) are authoritative — untouched.
UPDATE employees e
SET department_id = d.id
FROM departments d
WHERE e.department_id IS NULL
  AND e.department IS NOT NULL AND btrim(e.department) <> ''
  AND d.tenant_id = e.tenant_id
  AND lower(btrim(d.name)) = lower(btrim(e.department));

-- Assertion: every employee with a department text is now linked.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM employees
  WHERE department IS NOT NULL AND btrim(department) <> '' AND department_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — % employee(s) with a department text but no department_id after backfill', n;
  END IF;
END $$;

-- Cross-tenant sanity: a linked department must belong to the employee's tenant.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM employees e JOIN departments d ON d.id = e.department_id
  WHERE d.tenant_id <> e.tenant_id;
  IF n > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — % employee(s) linked to another tenant''s department', n;
  END IF;
END $$;

-- ── Phase 4: outlets.department_id backfill → NOT NULL ───────────────────
-- Tenants that have outlets but zero departments get a 'General' fallback
-- so NOT NULL below can hold.
INSERT INTO departments (tenant_id, name)
SELECT DISTINCT o.tenant_id, 'General'
FROM outlets o
WHERE NOT EXISTS (SELECT 1 FROM departments d WHERE d.tenant_id = o.tenant_id);

-- Infer each unassigned outlet's department from the department of its
-- most-common employee (shift count via employees × shifts). Ties break by
-- shift count desc, then department name asc (mirrors the "first
-- alphabetically" default).
WITH counts AS (
  SELECT s.outlet_id, e.department_id, d.name AS dept_name, count(*) AS n
  FROM shifts s
  JOIN employees e ON e.id = s.employee_id
  JOIN departments d ON d.id = e.department_id
  WHERE s.outlet_id IS NOT NULL AND e.department_id IS NOT NULL
  GROUP BY s.outlet_id, e.department_id, d.name
), best AS (
  SELECT DISTINCT ON (outlet_id) outlet_id, department_id
  FROM counts
  ORDER BY outlet_id, n DESC, lower(dept_name) ASC
)
UPDATE outlets o
SET department_id = b.department_id
FROM best b
JOIN departments d ON d.id = b.department_id
WHERE o.id = b.outlet_id
  AND o.department_id IS NULL
  AND d.tenant_id = o.tenant_id;   -- never adopt a cross-tenant inference

-- Ambiguous / shiftless outlets → the tenant's default department
-- (first alphabetically, per spec).
UPDATE outlets o
SET department_id = (
  SELECT d.id FROM departments d
  WHERE d.tenant_id = o.tenant_id
  ORDER BY lower(btrim(d.name)) ASC, d.created_at NULLS LAST, d.id
  LIMIT 1
)
WHERE o.department_id IS NULL;

-- Assertions, then lock it down.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM outlets WHERE department_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — % outlet(s) still without a department after backfill', n;
  END IF;
  SELECT count(*) INTO n FROM outlets o JOIN departments d ON d.id = o.department_id
  WHERE d.tenant_id <> o.tenant_id;
  IF n > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — % outlet(s) linked to another tenant''s department', n;
  END IF;
END $$;

ALTER TABLE outlets ALTER COLUMN department_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS outlets_department_id_idx ON outlets (department_id);

-- ── Phase 5: tip_pool_mode — migrate values + CHECK ──────────────────────
UPDATE outlets SET tip_pool_mode = lower(btrim(tip_pool_mode))
WHERE tip_pool_mode IS NOT NULL AND tip_pool_mode <> lower(btrim(tip_pool_mode));
UPDATE outlets SET tip_pool_mode = 'pool_daily'       WHERE tip_pool_mode = 'pool';
UPDATE outlets SET tip_pool_mode = 'individual_daily' WHERE tip_pool_mode = 'individual';

-- Any value outside the 4 new ones (NULL stays legal) aborts loudly rather
-- than being silently rewritten.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT tip_pool_mode, ', ') INTO bad FROM outlets
  WHERE tip_pool_mode IS NOT NULL
    AND tip_pool_mode NOT IN ('pool_daily','pool_weekly','individual_daily','no_tips');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — unexpected tip_pool_mode value(s): %. Fix by hand, then re-run.', bad;
  END IF;
END $$;

ALTER TABLE outlets DROP CONSTRAINT IF EXISTS outlets_tip_pool_mode_check;
ALTER TABLE outlets ADD CONSTRAINT outlets_tip_pool_mode_check
  CHECK (tip_pool_mode IN ('pool_daily','pool_weekly','individual_daily','no_tips'));

-- ── Phase 6: department_positions backfill ───────────────────────────────
-- Every position name known per department: from its outlets' role configs
-- and from junction assignments (legacy names employees already hold).
INSERT INTO department_positions (tenant_id, department_id, position_name)
SELECT DISTINCT ON (o.department_id, lower(btrim(src.position_name)))
       o.tenant_id, o.department_id, btrim(src.position_name)
FROM (
  SELECT outlet_id, position_name FROM outlet_roles WHERE position_name IS NOT NULL
  UNION
  SELECT outlet_id, position_name FROM employee_outlets WHERE position_name IS NOT NULL
) src
JOIN outlets o ON o.id = src.outlet_id
WHERE btrim(src.position_name) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM department_positions dp
    WHERE dp.department_id = o.department_id
      AND lower(btrim(dp.position_name)) = lower(btrim(src.position_name))
  )
ORDER BY o.department_id, lower(btrim(src.position_name));

-- ── Phase 7: tip engine — 4-mode ts_compute (in place, shim-aware) ───────
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
  -- Expect either the 019-P2 live body (salary guard) or an earlier 027 run
  -- (sentinel: pool_weekly). Anything else has drifted — hand-review first.
  IF position($a$coalesce(emp.pay_type, 'hourly') <> 'salary'$a$ IN v_def) = 0
     AND position('pool_weekly' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — % body is neither the 019 engine nor 027''s; live body drifted, patch by hand', v_target;
  END IF;

  v_name := CASE WHEN v_target = to_regprocedure('public.ts_compute_unguarded(uuid)')
                 THEN 'ts_compute_unguarded' ELSE 'ts_compute' END;

  v_body := $ts027$
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
  -- 027: the compute set — one sheet (daily modes) or the outlet's week.
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

  -- 027: no-tips outlets never distribute — return the marker, touch nothing.
  if v_mode = 'no_tips' then
    return jsonb_build_object(
      'tip_sheet_id', p_tip_sheet_id,
      'mode', 'no_tips',
      'status', v_sheet.status,
      'skipped', true,
      'message', 'no tips at this outlet');
  end if;

  -- 027: unknown modes now raise (pre-027 anything non-'pool' silently
  -- computed as individual). Legacy literals accepted defensively.
  if v_mode not in ('pool','pool_daily','pool_weekly','individual','individual_daily') then
    raise exception 'Unknown tip_pool_mode "%" — expected pool_daily, pool_weekly, individual_daily or no_tips', v_mode;
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

  -- Declared sheet-level totals — one sheet, or the whole week summed.
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

  update tip_sheet_rows set tip_amount = 0, sc_amount = 0, nc_amount = 0
   where tip_sheet_id = any(v_sheet_ids);
  update tip_sheet_rows tsr set role = e.role from _ts_elig e where e.row_id = tsr.id;

  if v_mode in ('pool','pool_daily','pool_weekly') then
    -- SC pool (minus the house+manager pullback) and NC pool, distributed
    -- separately by eff_hours × points — per day, or across the week.
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
end;$ts027$;

  -- CREATE OR REPLACE keeps ownership + ACLs (unguarded stays revoked from
  -- authenticated per 014; the shim keeps delegating).
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.%I(p_tip_sheet_id uuid) RETURNS jsonb
     LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L',
    v_name, v_body);
END $eng$;

-- ── Phase 8: tip_declaration_submit — refuse for no_tips (016 pattern) ───
DO $$
DECLARE
  v_def text;
  v_anchor constant text :=
    '-- The newest PENDING sheet for this outlet + day is the editable target.';
  v_patch constant text :=
    $p$-- 027: no-tips outlets refuse declarations outright.
  IF (SELECT o.tip_pool_mode FROM outlets o
      WHERE o.id = p_outlet_id AND o.tenant_id = public.current_tenant_id()) = 'no_tips' THEN
    RAISE EXCEPTION 'This outlet does not track tips';
  END IF;

  -- The newest PENDING sheet for this outlet + day is the editable target.$p$;
BEGIN
  IF to_regprocedure('public.tip_declaration_submit(uuid, date, numeric, numeric, numeric)') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — tip_declaration_submit not found; apply 009 first';
  END IF;
  v_def := pg_get_functiondef(to_regprocedure('public.tip_declaration_submit(uuid, date, numeric, numeric, numeric)'));
  IF position('no_tips' IN v_def) > 0 THEN
    RAISE NOTICE 'tip_declaration_submit already no_tips-aware — skipping patch';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — expected exactly one anchor in tip_declaration_submit; live body drifted, patch by hand';
  END IF;
  EXECUTE replace(v_def, v_anchor, v_patch);
END $$;

-- ── Phase 9: tip_declaration_for_me — expose tip_pool_mode ───────────────
-- Return-shape change ⇒ DROP + re-create (42P13) + re-grant. Body is 009's
-- verbatim plus the mode column, selected BEFORE the no-sheet early return
-- (a no-tips outlet never has a sheet — mobile still needs the mode then).
DROP FUNCTION IF EXISTS tip_declaration_for_me(uuid, date);

CREATE OR REPLACE FUNCTION tip_declaration_for_me(
  p_outlet_id uuid,
  p_shift_date date
)
RETURNS TABLE (
  sheet_exists boolean,
  sheet_open boolean,
  sheet_status text,
  row_id uuid,
  declared_service_charge numeric,
  declared_non_cash numeric,
  declared_large_party numeric,
  tip_amount numeric,
  tip_pool_mode text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_sheet tip_sheets%rowtype;
  v_mode text;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  IF p_outlet_id IS NULL OR p_shift_date IS NULL THEN
    RAISE EXCEPTION 'Outlet and shift date are required';
  END IF;

  -- 027: the outlet's mode rides along on every return shape.
  SELECT o.tip_pool_mode INTO v_mode FROM outlets o
  WHERE o.id = p_outlet_id AND o.tenant_id = public.current_tenant_id();

  -- Prefer the sheet holding my row, then pending, then newest.
  SELECT ts.* INTO v_sheet
  FROM tip_sheets ts
  WHERE ts.outlet_id = p_outlet_id
    AND ts.date = p_shift_date
    AND ts.tenant_id = public.current_tenant_id()
  ORDER BY EXISTS (
             SELECT 1 FROM tip_sheet_rows r
             WHERE r.tip_sheet_id = ts.id AND r.employee_id = v_emp
           ) DESC,
           (ts.status = 'pending') DESC NULLS LAST,
           ts.created_at DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, NULL::text, NULL::uuid,
                        NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric,
                        v_mode;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT true,
         v_sheet.status IS NOT DISTINCT FROM 'pending',
         v_sheet.status,
         r.id,
         r.declared_service_charge,
         r.declared_non_cash,
         lp.rev,
         CASE WHEN v_sheet.status = 'posted' THEN r.tip_amount END,
         v_mode
  FROM (SELECT 1) one
  LEFT JOIN tip_sheet_rows r
    ON r.tip_sheet_id = v_sheet.id AND r.employee_id = v_emp
  LEFT JOIN LATERAL (
    SELECT sum(l.revenue) AS rev FROM large_party_revenues l
    WHERE l.declared_by_row_id = r.id
  ) lp ON true;
END;
$$;

REVOKE ALL ON FUNCTION tip_declaration_for_me(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tip_declaration_for_me(uuid, date) TO authenticated;

-- ── Phase 10: pay_breakdown — restore 014's tenant filter (023 regression)
-- 023's rewrite reverted both `setup` pay-cycle reads to the unfiltered
-- `limit 1` form 014 had deliberately tenant-scoped (cross-tenant read
-- under pay_breakdown_for_me's SECURITY DEFINER delegation). Surgical
-- restore; the biweekly OT math is untouched.
DO $$
DECLARE
  v_def text;
  v_anchor constant text := '(select pay_cycle from setup limit 1)';
  v_patch  constant text :=
    '(select pay_cycle from setup where tenant_id = public.current_tenant_id() limit 1)';
BEGIN
  IF to_regprocedure('public.pay_breakdown(date, date, text)') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — pay_breakdown not found';
  END IF;
  v_def := pg_get_functiondef(to_regprocedure('public.pay_breakdown(date, date, text)'));
  IF position(v_anchor IN v_def) = 0 THEN
    RAISE NOTICE 'pay_breakdown setup reads already tenant-filtered — skipping patch';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 2 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — expected exactly two unfiltered setup reads in pay_breakdown; live body drifted, patch by hand';
  END IF;
  EXECUTE replace(v_def, v_anchor, v_patch);
END $$;

-- ── Phase 11: hierarchy RPCs ─────────────────────────────────────────────
-- All manager-guarded (024 idiom: tenant + is_restaurant_manager), SECURITY
-- DEFINER ⇒ every statement scopes by tenant explicitly. NOTE on arg order
-- vs the PR spec: optional args (p_id, p_points, p_tip_pool_mode) must sit
-- LAST — Postgres requires defaulted parameters to be trailing.

-- department_upsert: create (p_id NULL) or rename. Case-insensitive dup
-- guard inside the tenant.
DROP FUNCTION IF EXISTS public.department_upsert(text, uuid);
CREATE FUNCTION public.department_upsert(
  p_name text,
  p_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant on your session'; END IF;
  IF NOT public.is_restaurant_manager() THEN RAISE EXCEPTION 'Managers only'; END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Department name is required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM departments d
    WHERE d.tenant_id = v_tenant
      AND lower(btrim(d.name)) = lower(btrim(p_name))
      AND (p_id IS NULL OR d.id <> p_id)
  ) THEN
    RAISE EXCEPTION 'A department named "%" already exists', btrim(p_name);
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO departments (tenant_id, name) VALUES (v_tenant, btrim(p_name))
    RETURNING id INTO v_id;
  ELSE
    UPDATE departments SET name = btrim(p_name), updated_at = now()
    WHERE id = p_id AND tenant_id = v_tenant
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Department not found'; END IF;
  END IF;
  RETURN v_id;
END;
$$;

-- department_delete: refuses while outlets or employees still point at it.
-- The position catalog cascades away with the row (FK ON DELETE CASCADE).
DROP FUNCTION IF EXISTS public.department_delete(uuid);
CREATE FUNCTION public.department_delete(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  n_outlets int;
  n_employees int;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant on your session'; END IF;
  IF NOT public.is_restaurant_manager() THEN RAISE EXCEPTION 'Managers only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM departments d WHERE d.id = p_id AND d.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Department not found';
  END IF;
  SELECT count(*) INTO n_outlets FROM outlets o
  WHERE o.department_id = p_id AND o.tenant_id = v_tenant;
  SELECT count(*) INTO n_employees FROM employees e
  WHERE e.department_id = p_id AND e.tenant_id = v_tenant;
  IF n_outlets > 0 OR n_employees > 0 THEN
    RAISE EXCEPTION 'Department still has % outlet(s) and % employee(s) — move them first',
      n_outlets, n_employees;
  END IF;
  DELETE FROM departments WHERE id = p_id AND tenant_id = v_tenant;
END;
$$;

-- department_list: the Establishment landing page's cards. `type` rides
-- along for the legacy FOH/BOH chip.
DROP FUNCTION IF EXISTS public.department_list();
CREATE FUNCTION public.department_list()
RETURNS TABLE (id uuid, name text, type text, outlet_count int, position_count int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant on your session'; END IF;
  IF NOT public.is_restaurant_manager() THEN RAISE EXCEPTION 'Managers only'; END IF;
  RETURN QUERY
  SELECT d.id, d.name, d.type,
         (SELECT count(*) FROM outlets o
           WHERE o.department_id = d.id AND o.tenant_id = v_tenant)::int,
         (SELECT count(*) FROM department_positions dp
           WHERE dp.department_id = d.id AND dp.tenant_id = v_tenant)::int
  FROM departments d
  WHERE d.tenant_id = v_tenant
  ORDER BY lower(d.name);
END;
$$;

-- department_position_add / _remove: the department's position catalog.
-- Remove refuses while the position is still assigned to any of the
-- department's outlets (unassign there first); employees keep their text
-- position either way.
DROP FUNCTION IF EXISTS public.department_position_add(uuid, text);
CREATE FUNCTION public.department_position_add(
  p_department_id uuid,
  p_position_name text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant on your session'; END IF;
  IF NOT public.is_restaurant_manager() THEN RAISE EXCEPTION 'Managers only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM departments d WHERE d.id = p_department_id AND d.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Department not found';
  END IF;
  IF p_position_name IS NULL OR btrim(p_position_name) = '' THEN
    RAISE EXCEPTION 'Position name is required';
  END IF;
  SELECT dp.id INTO v_id FROM department_positions dp
  WHERE dp.department_id = p_department_id
    AND lower(btrim(dp.position_name)) = lower(btrim(p_position_name));
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO department_positions (tenant_id, department_id, position_name)
  VALUES (v_tenant, p_department_id, btrim(p_position_name))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.department_position_remove(uuid, text);
CREATE FUNCTION public.department_position_remove(
  p_department_id uuid,
  p_position_name text
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  n int;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant on your session'; END IF;
  IF NOT public.is_restaurant_manager() THEN RAISE EXCEPTION 'Managers only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM departments d WHERE d.id = p_department_id AND d.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Department not found';
  END IF;
  SELECT count(*) INTO n
  FROM outlet_roles orl
  JOIN outlets o ON o.id = orl.outlet_id
  WHERE o.department_id = p_department_id AND o.tenant_id = v_tenant
    AND lower(btrim(orl.position_name)) = lower(btrim(coalesce(p_position_name, '')));
  IF n > 0 THEN
    RAISE EXCEPTION 'Position is still assigned to % outlet(s) in this department — unassign it there first', n;
  END IF;
  DELETE FROM department_positions dp
  WHERE dp.department_id = p_department_id
    AND dp.tenant_id = v_tenant
    AND lower(btrim(dp.position_name)) = lower(btrim(coalesce(p_position_name, '')));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- outlet_upsert: create under a department (mode defaults to pool_daily —
-- closing the latent "new outlets have NULL mode and ts_compute raises"
-- bug) or update name/mode/department. p_tip_pool_mode NULL on update
-- means "leave unchanged".
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
     AND v_mode NOT IN ('pool_daily','pool_weekly','individual_daily','no_tips') THEN
    RAISE EXCEPTION 'Invalid tip_pool_mode "%" — expected pool_daily, pool_weekly, individual_daily or no_tips', v_mode;
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
    VALUES (v_tenant, p_department_id, btrim(p_name), coalesce(v_mode, 'pool_daily'))
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

-- outlet_assign_position: upsert the outlet_roles row (case-insensitive
-- match — the 019 lesson) and set points; is_tipped / tip-out config on an
-- existing row is preserved. Also self-heals the department catalog so an
-- assigned position can never be missing from its department.
DROP FUNCTION IF EXISTS public.outlet_assign_position(uuid, text, numeric);
CREATE FUNCTION public.outlet_assign_position(
  p_outlet_id uuid,
  p_position_name text,
  p_points numeric DEFAULT 1
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_dept uuid;
  v_role uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant on your session'; END IF;
  IF NOT public.is_restaurant_manager() THEN RAISE EXCEPTION 'Managers only'; END IF;
  SELECT o.department_id INTO v_dept FROM outlets o
  WHERE o.id = p_outlet_id AND o.tenant_id = v_tenant;
  IF v_dept IS NULL THEN RAISE EXCEPTION 'Outlet not found'; END IF;
  IF p_position_name IS NULL OR btrim(p_position_name) = '' THEN
    RAISE EXCEPTION 'Position name is required';
  END IF;
  IF p_points IS NULL OR p_points < 0 THEN
    RAISE EXCEPTION 'Points must be zero or greater';
  END IF;

  SELECT orl.id INTO v_role FROM outlet_roles orl
  WHERE orl.outlet_id = p_outlet_id
    AND lower(btrim(orl.position_name)) = lower(btrim(p_position_name));

  IF v_role IS NULL THEN
    INSERT INTO outlet_roles (tenant_id, outlet_id, position_name, points)
    VALUES (v_tenant, p_outlet_id, btrim(p_position_name), p_points)
    RETURNING id INTO v_role;
  ELSE
    UPDATE outlet_roles SET points = p_points WHERE id = v_role;
  END IF;

  -- Catalog self-heal (also covers pre-027 flows that only wrote roles).
  INSERT INTO department_positions (tenant_id, department_id, position_name)
  SELECT v_tenant, v_dept, btrim(p_position_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM department_positions dp
    WHERE dp.department_id = v_dept
      AND lower(btrim(dp.position_name)) = lower(btrim(p_position_name))
  );
  RETURN v_role;
END;
$$;

-- outlet_unassign_position: drop the outlet_roles row. PARS rows for the
-- position survive (the Setup PARS editor shows them as "removed role");
-- employee_outlets keep their text position (points display falls back).
DROP FUNCTION IF EXISTS public.outlet_unassign_position(uuid, text);
CREATE FUNCTION public.outlet_unassign_position(
  p_outlet_id uuid,
  p_position_name text
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  n int;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant on your session'; END IF;
  IF NOT public.is_restaurant_manager() THEN RAISE EXCEPTION 'Managers only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM outlets o WHERE o.id = p_outlet_id AND o.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Outlet not found';
  END IF;
  DELETE FROM outlet_roles orl
  WHERE orl.outlet_id = p_outlet_id
    AND orl.tenant_id = v_tenant
    AND lower(btrim(orl.position_name)) = lower(btrim(coalesce(p_position_name, '')));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- outlet_list_for_department: the department page's outlet cards.
DROP FUNCTION IF EXISTS public.outlet_list_for_department(uuid);
CREATE FUNCTION public.outlet_list_for_department(p_department_id uuid)
RETURNS TABLE (id uuid, name text, tip_pool_mode text, position_count int, employee_count int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant on your session'; END IF;
  IF NOT public.is_restaurant_manager() THEN RAISE EXCEPTION 'Managers only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM departments d WHERE d.id = p_department_id AND d.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Department not found';
  END IF;
  RETURN QUERY
  SELECT o.id, o.name, o.tip_pool_mode,
         (SELECT count(*) FROM outlet_roles orl WHERE orl.outlet_id = o.id)::int,
         (SELECT count(*) FROM employee_outlets eo WHERE eo.outlet_id = o.id)::int
  FROM outlets o
  WHERE o.department_id = p_department_id AND o.tenant_id = v_tenant
  ORDER BY lower(o.name);
END;
$$;

-- outlet_detail: everything the outlet page needs in one call — the outlet
-- + its department, the parent department's position catalog with per-
-- position assignment state (checkbox list), and the assigned team
-- (employee_outlets ⨝ employees, points resolved via the outlet's role for
-- that position). Legacy outlet_roles rows missing from the catalog are
-- appended flagged in_catalog=false so nothing is invisible.
DROP FUNCTION IF EXISTS public.outlet_detail(uuid);
CREATE FUNCTION public.outlet_detail(p_outlet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_outlet outlets%rowtype;
  v_dept_name text;
  v_positions jsonb;
  v_employees jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant on your session'; END IF;
  IF NOT public.is_restaurant_manager() THEN RAISE EXCEPTION 'Managers only'; END IF;
  SELECT * INTO v_outlet FROM outlets o
  WHERE o.id = p_outlet_id AND o.tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Outlet not found'; END IF;
  SELECT d.name INTO v_dept_name FROM departments d WHERE d.id = v_outlet.department_id;

  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY lower(p.position_name)), '[]'::jsonb)
  INTO v_positions
  FROM (
    SELECT dp.position_name,
           true AS in_catalog,
           (orl.id IS NOT NULL) AS assigned,
           orl.id AS role_id,
           orl.points,
           orl.is_tipped
    FROM department_positions dp
    LEFT JOIN outlet_roles orl
      ON orl.outlet_id = v_outlet.id
     AND lower(btrim(orl.position_name)) = lower(btrim(dp.position_name))
    WHERE dp.department_id = v_outlet.department_id
      AND dp.tenant_id = v_tenant
    UNION ALL
    SELECT orl.position_name, false, true, orl.id, orl.points, orl.is_tipped
    FROM outlet_roles orl
    WHERE orl.outlet_id = v_outlet.id
      AND NOT EXISTS (
        SELECT 1 FROM department_positions dp
        WHERE dp.department_id = v_outlet.department_id
          AND lower(btrim(dp.position_name)) = lower(btrim(orl.position_name))
      )
  ) p;

  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY lower(t.last_name), lower(t.first_name)), '[]'::jsonb)
  INTO v_employees
  FROM (
    SELECT eo.id AS employee_outlet_id,
           e.id AS employee_id,
           e.first_name,
           e.last_name,
           eo.position_name,
           orl.points,
           e.termination_date
    FROM employee_outlets eo
    JOIN employees e ON e.id = eo.employee_id
    LEFT JOIN outlet_roles orl
      ON orl.outlet_id = v_outlet.id
     AND lower(btrim(orl.position_name)) = lower(btrim(coalesce(eo.position_name, '')))
    WHERE eo.outlet_id = v_outlet.id
      AND eo.tenant_id = v_tenant
      AND e.tenant_id = v_tenant
  ) t;

  RETURN jsonb_build_object(
    'outlet', jsonb_build_object(
      'id', v_outlet.id,
      'name', v_outlet.name,
      'tip_pool_mode', v_outlet.tip_pool_mode,
      'department_id', v_outlet.department_id,
      'department_name', v_dept_name
    ),
    'positions', v_positions,
    'employees', v_employees
  );
END;
$$;

-- Grants: employee-callable nothing — manager surfaces only (the functions
-- self-gate; authenticated needs EXECUTE for PostgREST to reach them).
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.department_upsert(text, uuid)',
    'public.department_delete(uuid)',
    'public.department_list()',
    'public.department_position_add(uuid, text)',
    'public.department_position_remove(uuid, text)',
    'public.outlet_upsert(uuid, text, text, uuid)',
    'public.outlet_assign_position(uuid, text, numeric)',
    'public.outlet_unassign_position(uuid, text)',
    'public.outlet_list_for_department(uuid)',
    'public.outlet_detail(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;

-- ── Phase 12: final assertions ───────────────────────────────────────────
DO $$
DECLARE
  v_def text;
  v_target regprocedure;
  fn text;
BEGIN
  -- 12a. The engine speaks all four modes.
  v_target := coalesce(to_regprocedure('public.ts_compute_unguarded(uuid)'),
                       to_regprocedure('public.ts_compute(uuid)'));
  v_def := pg_get_functiondef(v_target);
  IF position('no_tips' IN v_def) = 0 OR position('pool_weekly' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — % lacks the 027 modes', v_target;
  END IF;

  -- 12b. Declarations refuse at no-tips outlets.
  v_def := pg_get_functiondef(to_regprocedure('public.tip_declaration_submit(uuid, date, numeric, numeric, numeric)'));
  IF position('no_tips' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — tip_declaration_submit not no_tips-aware';
  END IF;

  -- 12c. pay_breakdown setup reads are tenant-filtered again.
  v_def := pg_get_functiondef(to_regprocedure('public.pay_breakdown(date, date, text)'));
  IF position('from setup limit 1' IN v_def) > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — pay_breakdown still reads setup unfiltered';
  END IF;

  -- 12d. tip_declaration_for_me returns the mode.
  IF position('tip_pool_mode' IN
       pg_get_function_result(to_regprocedure('public.tip_declaration_for_me(uuid, date)'))) = 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — tip_declaration_for_me lacks tip_pool_mode';
  END IF;

  -- 12e. Every new RPC exists.
  FOREACH fn IN ARRAY ARRAY[
    'public.department_upsert(text, uuid)',
    'public.department_delete(uuid)',
    'public.department_list()',
    'public.department_position_add(uuid, text)',
    'public.department_position_remove(uuid, text)',
    'public.outlet_upsert(uuid, text, text, uuid)',
    'public.outlet_assign_position(uuid, text, numeric)',
    'public.outlet_unassign_position(uuid, text)',
    'public.outlet_list_for_department(uuid)',
    'public.outlet_detail(uuid)'
  ] LOOP
    IF to_regprocedure(fn) IS NULL THEN
      RAISE EXCEPTION 'ASSERTION FAILED — % was not created', fn;
    END IF;
  END LOOP;

  -- 12f. Tenant-scoped policies present on both new/promoted tables.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'departments'
      AND policyname = 'manager_full_access' AND qual LIKE '%current_tenant_id%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'department_positions'
      AND policyname = 'manager_full_access' AND qual LIKE '%current_tenant_id%'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED — departments / department_positions policies not tenant-scoped';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run as-is after the COMMIT) ────────────────────────────
-- 1. Hierarchy coverage — expect 0 in both "unlinked" columns.
SELECT
  (SELECT count(*) FROM outlets)                                            AS outlets_total,
  (SELECT count(*) FROM outlets WHERE department_id IS NULL)                AS outlets_unlinked,
  (SELECT count(*) FROM employees
    WHERE department IS NOT NULL AND btrim(department) <> ''
      AND department_id IS NULL)                                            AS employees_unlinked,
  (SELECT count(*) FROM departments)                                        AS departments_total,
  (SELECT count(*) FROM department_positions)                               AS catalog_positions;

-- 2. Mode distribution — only the four new values (or NULL) may appear.
SELECT coalesce(tip_pool_mode, '(null)') AS mode, count(*)
FROM outlets GROUP BY 1 ORDER BY 1;

-- 3. Engine spot-checks.
SELECT proname, position('pool_weekly' IN pg_get_functiondef(oid)) > 0 AS has_weekly,
       position('no_tips' IN pg_get_functiondef(oid)) > 0 AS has_no_tips
FROM pg_proc
WHERE proname IN ('ts_compute_unguarded', 'ts_compute', 'tip_declaration_submit')
  AND pronamespace = 'public'::regnamespace;

-- ── Rollback (run by hand only — restores the pre-027 posture) ───────────
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.department_upsert(text, uuid);
-- DROP FUNCTION IF EXISTS public.department_delete(uuid);
-- DROP FUNCTION IF EXISTS public.department_list();
-- DROP FUNCTION IF EXISTS public.department_position_add(uuid, text);
-- DROP FUNCTION IF EXISTS public.department_position_remove(uuid, text);
-- DROP FUNCTION IF EXISTS public.outlet_upsert(uuid, text, text, uuid);
-- DROP FUNCTION IF EXISTS public.outlet_assign_position(uuid, text, numeric);
-- DROP FUNCTION IF EXISTS public.outlet_unassign_position(uuid, text);
-- DROP FUNCTION IF EXISTS public.outlet_list_for_department(uuid);
-- DROP FUNCTION IF EXISTS public.outlet_detail(uuid);
-- ALTER TABLE outlets DROP CONSTRAINT IF EXISTS outlets_tip_pool_mode_check;
-- UPDATE outlets SET tip_pool_mode = 'pool'       WHERE tip_pool_mode IN ('pool_daily','pool_weekly');
-- UPDATE outlets SET tip_pool_mode = 'individual' WHERE tip_pool_mode = 'individual_daily';
-- UPDATE outlets SET tip_pool_mode = NULL         WHERE tip_pool_mode = 'no_tips';
-- ALTER TABLE outlets ALTER COLUMN department_id DROP NOT NULL;
-- DROP TABLE IF EXISTS department_positions;
-- -- departments keeps tenant_id (harmless); re-apply 009's
-- -- tip_declaration_for_me and re-run 013→019 (or tip_sheet.sql + 014 +
-- -- 017 + 019) to restore the daily-only engine; re-run 023 to restore
-- -- pay_breakdown (note: that re-opens the setup tenant-filter regression).
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';

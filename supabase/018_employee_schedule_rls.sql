-- =========================================================================
-- Migration 018 (Phase 2) — Employee-grade RLS for the Schedule tab.
-- Run in the Supabase SQL editor AFTER 005/007 (and the rest of the applied
-- chain). Idempotent; safe to re-run.
--
-- THE BUG (flagged as a KNOWN RLS GAP back in PR #4): employees, shifts and
-- outlets carry only the manager_full_access policy (004b, tenant-scoped by
-- 005), so a non-manager sees ZERO rows — the mobile Schedule tab lands on
-- "isn't linked to an employee record" even for a fully-linked employee.
--
-- WHAT THIS ADDS (all additive SELECT policies — manager visibility and all
-- write paths are untouched):
--   1. employees.own_rows_select — your own employees row
--      (auth_user_id = auth.uid()), which getCurrentEmployee reads.
--   2. shifts.own_rows_select — your own shifts (the 007/008 shape).
--   3. shifts.teammate_shifts_select — SAME-DEPARTMENT teammates' shifts at
--      YOUR outlets (the visibility getTeammatesForWeek always intended),
--      via SECURITY DEFINER employee_sees_team_shift(owner, outlet) — a
--      policy on shifts cannot subquery shifts under its own RLS (infinite
--      recursion), so the helper carries the definition and the RPC below
--      shares it, the 010 pattern (policy and surface can never drift).
--      "Your outlets" = the 010 membership triple: home_outlet_id, an
--      employee_outlets row, or any shift there. Departments compare
--      case-insensitively (the Day-2/019 casing lesson).
--   4. outlets.tenant_member_select — outlet NAMES for every tenant member
--      (the shifts embed renders them; part of PR #4's flagged list).
--   5. my_teammate_shifts(p_start, p_end) — the teammates FEED. The old
--      client query embedded employees!inner, which can only work if
--      teammates' employees ROWS are readable — and an RLS policy there
--      would expose their whole row (pay rates, DOB, phone) to any direct
--      query, since RLS has no column granularity. DELIBERATELY NOT DONE.
--      Instead teammate names travel through this SECURITY DEFINER RPC
--      exposing exactly the safe columns (shift fields + first/last name +
--      outlet name), like every other name surface since 010. It narrows
--      to outlets where the CALLER is scheduled inside [p_start, p_end] —
--      the exact behavior the client had — and returns an EMPTY SET for
--      unlinked callers (the 016 no-400s posture for polled read feeds).
--
-- employees.own_rows_select DOES expose the caller's own full row (their
-- own rates) — their own data, same posture as pay_breakdown_for_me.
-- =========================================================================

BEGIN;

-- ── 0. Fail fast if the chain isn't applied ──────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.current_tenant_id()') IS NULL
     OR to_regprocedure('public.current_employee_id()') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — apply 005 (current_tenant_id) and 007 (current_employee_id) first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shifts' AND column_name = 'tenant_id'
  ) THEN
    RAISE EXCEPTION 'PREREQ FAILED — shifts.tenant_id missing; apply 005 first';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND policyname = 'manager_full_access'
        AND tablename IN ('employees', 'shifts', 'outlets')) <> 3 THEN
    RAISE EXCEPTION 'PREREQ FAILED — manager_full_access missing on employees/shifts/outlets; apply 004b + 005 first';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('employees', 'shifts', 'outlets')
      AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'PREREQ FAILED — RLS not enabled on employees/shifts/outlets';
  END IF;
END $$;

-- ── 1. Own employees row ─────────────────────────────────────────────────
DROP POLICY IF EXISTS own_rows_select ON employees;
CREATE POLICY own_rows_select ON employees FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND auth_user_id = auth.uid());

-- ── 2. Own shifts ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS own_rows_select ON shifts;
CREATE POLICY own_rows_select ON shifts FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND employee_id = public.current_employee_id());

-- ── 3. Teammate shifts: same department, at one of MY outlets ────────────
CREATE OR REPLACE FUNCTION public.employee_sees_team_shift(
  p_owner_id uuid,
  p_outlet_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_owner_id IS NOT NULL
     AND p_outlet_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM employees me
       JOIN employees owner ON owner.id = p_owner_id
       WHERE me.id = public.current_employee_id()
         AND me.id <> p_owner_id
         AND owner.tenant_id = me.tenant_id
         AND me.department IS NOT NULL
         AND lower(owner.department) = lower(me.department)
         AND (
           me.home_outlet_id = p_outlet_id
           OR EXISTS (SELECT 1 FROM employee_outlets eo
                      WHERE eo.employee_id = me.id
                        AND eo.outlet_id = p_outlet_id)
           OR EXISTS (SELECT 1 FROM shifts s
                      WHERE s.employee_id = me.id
                        AND s.outlet_id = p_outlet_id)
         )
     );
$$;
REVOKE ALL ON FUNCTION public.employee_sees_team_shift(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_sees_team_shift(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS teammate_shifts_select ON shifts;
CREATE POLICY teammate_shifts_select ON shifts FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND public.employee_sees_team_shift(employee_id, outlet_id));

-- ── 4. Outlet names for tenant members ───────────────────────────────────
DROP POLICY IF EXISTS tenant_member_select ON outlets;
CREATE POLICY tenant_member_select ON outlets FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- ── 5. The teammates feed (names travel here, never via employees RLS) ───
-- Column names follow 010's convention (shift_date / shift_position / …) —
-- also avoids `date` / `position` shadowing hazards in plpgsql.
CREATE OR REPLACE FUNCTION public.my_teammate_shifts(
  p_start date,
  p_end   date
) RETURNS TABLE (
  shift_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  shift_type text,
  notes text,
  shift_position text,
  outlet_id uuid,
  outlet_name text,
  employee_id uuid,
  first_name text,
  last_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
BEGIN
  -- Unlinked / no-tenant callers get an empty feed, never a 400 (016 rule).
  IF v_emp IS NULL OR public.current_tenant_id() IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s.id, s.date, s.start_time, s.end_time, s.shift_type, s.notes,
         s.position, s.outlet_id, o.name, s.employee_id,
         e.first_name, e.last_name
  FROM shifts s
  JOIN employees e ON e.id = s.employee_id
  LEFT JOIN outlets o ON o.id = s.outlet_id
  WHERE s.tenant_id = public.current_tenant_id()
    AND s.date BETWEEN p_start AND p_end
    -- shared ceiling: same department, at an outlet I'm a member of
    AND public.employee_sees_team_shift(s.employee_id, s.outlet_id)
    -- exact client behavior: only outlets where I'M scheduled this range
    AND s.outlet_id IN (
      SELECT ms.outlet_id FROM shifts ms
      WHERE ms.employee_id = v_emp
        AND ms.date BETWEEN p_start AND p_end
        AND ms.outlet_id IS NOT NULL
    )
  ORDER BY s.date ASC, s.start_time ASC;
END;
$$;
REVOKE ALL ON FUNCTION public.my_teammate_shifts(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_teammate_shifts(date, date) TO authenticated;

-- ── 6. Assertions ────────────────────────────────────────────────────────
DO $$
DECLARE n int; v_qual text;
BEGIN
  -- 6a. The four new policies exist, SELECT-only, tenant-scoped.
  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND cmd = 'SELECT'
    AND qual LIKE '%current_tenant_id%'
    AND ((tablename = 'employees' AND policyname = 'own_rows_select')
      OR (tablename = 'shifts'    AND policyname = 'own_rows_select')
      OR (tablename = 'shifts'    AND policyname = 'teammate_shifts_select')
      OR (tablename = 'outlets'   AND policyname = 'tenant_member_select'));
  IF n <> 4 THEN
    RAISE EXCEPTION 'ASSERTION 1 FAILED — expected 4 scoped SELECT policies, found %', n;
  END IF;

  -- 6b. The shifts own-row policy is employee-pinned; teammate policy uses
  -- the shared helper.
  SELECT qual INTO v_qual FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'shifts' AND policyname = 'own_rows_select';
  IF v_qual NOT LIKE '%current_employee_id%' THEN
    RAISE EXCEPTION 'ASSERTION 2 FAILED — shifts own_rows_select not employee-pinned: %', v_qual;
  END IF;
  SELECT qual INTO v_qual FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'shifts' AND policyname = 'teammate_shifts_select';
  IF v_qual NOT LIKE '%employee_sees_team_shift%' THEN
    RAISE EXCEPTION 'ASSERTION 2 FAILED — teammate policy not using the shared helper: %', v_qual;
  END IF;

  -- 6c. NO employee-grade policy on employees beyond the own row — the
  -- whole point of routing names through the RPC (rates stay sealed).
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'employees'
               AND policyname NOT IN ('manager_full_access', 'own_rows_select')) THEN
    RAISE EXCEPTION 'ASSERTION 3 FAILED — unexpected extra policy on employees';
  END IF;

  -- 6d. manager_full_access untouched on all three tables.
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND policyname = 'manager_full_access'
        AND tablename IN ('employees', 'shifts', 'outlets')) <> 3 THEN
    RAISE EXCEPTION 'ASSERTION 4 FAILED — manager_full_access went missing';
  END IF;

  -- 6e. RPC + helper exist; anon locked out.
  IF to_regprocedure('public.my_teammate_shifts(date, date)') IS NULL
     OR to_regprocedure('public.employee_sees_team_shift(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION 5 FAILED — 018 functions missing';
  END IF;
  IF has_function_privilege('anon', 'public.my_teammate_shifts(date, date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION 5 FAILED — anon can execute my_teammate_shifts';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run by hand after applying) ────────────────────────────
-- 1. Policies (expect manager_full_access + the four new SELECT policies):
SELECT tablename, policyname, cmd FROM pg_policies
WHERE tablename IN ('employees', 'shifts', 'outlets')
ORDER BY tablename, policyname;
-- 2. Feed responds without error (SQL editor has no JWT → expect 0 rows):
SELECT * FROM public.my_teammate_shifts(current_date, current_date + 7);

-- ── Rollback (run by hand only) ──────────────────────────────────────────
-- DROP POLICY IF EXISTS own_rows_select ON employees;
-- DROP POLICY IF EXISTS own_rows_select ON shifts;
-- DROP POLICY IF EXISTS teammate_shifts_select ON shifts;
-- DROP POLICY IF EXISTS tenant_member_select ON outlets;
-- DROP FUNCTION IF EXISTS public.my_teammate_shifts(date, date);
-- DROP FUNCTION IF EXISTS public.employee_sees_team_shift(uuid, uuid);

-- =========================================================================
-- Migration 014 (Phase 2) — Pre-onboard hardening.
-- Run in the Supabase SQL editor AFTER every prior migration (005–013 and
-- all Phase 1 files). Idempotent; safe to re-run. One transaction.
--
-- NOTE ON NUMBERING: Phase 1 already has 014_manual_ot_rate.sql here; the
-- Phase 2 sequence continues per the PR #12 spec — no filename collision.
--
-- Closes the four gaps flagged across PRs #5–#11, before real employees:
--
-- 1. CALLER GUARDS on Phase 1 SECURITY DEFINER RPCs.
--    Audit result (every SECURITY DEFINER function in the Phase 1 files):
--      GUARDED via shim (19): pto_approve, pto_deny, pto_unapprove,
--        pto_adjust_balance, tc_save, tc_override, tc_create_adhoc,
--        tc_set_status, tc_add_note, pay_post_period, ts_add_large_party,
--        ts_reassign_manager, ts_compute, ts_post, ts_unpost, swap_create,
--        swap_accept, swap_cancel — minus tc_approve, which is REDEFINED
--        in full (see gap 4) with the guard inline. (18 shims + 1 redefine
--        = 19 guarded.)
--      REVOKED instead of guarded (2): pto_recompute_balance,
--        pto_accrue_for_timecard — internal plumbing invoked by other
--        SECURITY DEFINER functions and the timecard trigger. A manager
--        guard would break EMPLOYEE flows that reach them indirectly
--        (e.g. pto_cancel's balance restore); revoking EXECUTE from
--        authenticated/anon blocks direct PostgREST calls while definer-
--        internal calls keep working (privilege is checked as the definer).
--      LEFT ALONE, with reasons:
--        pto_summary, tc_lateness_range — LANGUAGE sql WITHOUT security
--          definer: they already run under the caller's RLS (an employee
--          gets only their own rows); guarding would only break nothing-
--          burger reads. pay_breakdown — same class (RLS-bound), and it
--          must stay employee-callable THROUGH pay_breakdown_for_me (008).
--        enforce_device_limit (006) — legitimately called by every user at
--          login (2-device cap).
--        trg_pto_accrue — RETURNS trigger; PostgREST cannot call it.
--        All Phase 2 RPCs (007–013) — already guarded at birth.
--    Guard: is_restaurant_manager() OR a service_role JWT. The web app's
--    server client uses the ANON key + user cookies (lib/supabase-server
--    .ts), so every web call carries the manager's own JWT and passes the
--    manager arm; the service_role arm is defensive headroom for future
--    server-side jobs, per the spec's err-on-the-side guidance.
--    Mechanism: the ORIGINAL function is renamed to <name>_unguarded
--    (EXECUTE revoked from everyone) and a SECURITY DEFINER shim with the
--    ORIGINAL name + signature + parameter names (PostgREST calls by
--    named argument) checks the guard and delegates. Bodies are not
--    copied, so Phase 1 behavior cannot drift.
--
-- 2. TENANT-TABLE REFRESH. coverage_requests (010), broadcasts,
--    broadcast_reads, broadcast_replies (013) join migration 005's
--    canonical contract: tenant_id NOT NULL + DEFAULT (they always had
--    it), a %_tenant_id_idx index (added here), tenant-filtered policies
--    (asserted here). The 005 FILE is updated in this same PR (rev 3) so
--    its _tenant_tables list includes them — a 005 re-run now passes its
--    assertion 3 instead of tripping on these tables.
--
-- 3. TIMEZONE FIX. setup.timezone (default 'America/Los_Angeles' — Adèle
--    is PT). New helpers tenant_tz() / tenant_today() / shift_start_at()
--    convert wall-clock shift times to absolute instants. Redefined with
--    real timezone math: swap_request_submit + swap_eligible_teammates +
--    employee_eligible_for_swap (the 24h cutoff and its candidate lists —
--    all three, so the list and the gate stay consistent), and
--    callout_submit + employee_eligible_for_coverage (their "today"
--    checks used the UTC date, which wrongly rejected same-day callouts
--    after 5pm PT). The old naive-vs-UTC comparison made the 24h cutoff
--    trip ~7-8h early for PT; it is now exact.
--
-- 4. PAY ENGINE TENANT FILTERS. pay_breakdown's internal
--    `select pay_cycle from setup limit 1` (flagged in 008) is now
--    tenant-filtered. Repo-wide audit of `from setup` inside function
--    bodies found exactly one other: tc_approve's thresholds read — fixed
--    by redefining tc_approve in full (tenant-filtered setup, caller
--    guard, and actor = the actual caller with a tenant-scoped legacy
--    fallback instead of first-manager-ever). pay_post_period reads no
--    setup. No other function has the pattern.
-- =========================================================================

BEGIN;

-- ── 0. Fail-fast prerequisites ───────────────────────────────────────────
DO $do$
DECLARE missing text := '';
BEGIN
  IF to_regprocedure('public.current_tenant_id()') IS NULL
     OR to_regprocedure('public.is_restaurant_manager()') IS NULL
     OR to_regprocedure('public.current_employee_id()') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — apply migrations 005 + 007 first';
  END IF;
  IF to_regclass('public.coverage_requests') IS NULL
     OR to_regclass('public.broadcasts') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — apply migrations 010 + 013 first';
  END IF;
  IF to_regprocedure('public.swap_request_submit(uuid, uuid, uuid)') IS NULL
     OR to_regprocedure('public.callout_submit(uuid, text, text)') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — apply migrations 010 + 011 first';
  END IF;
END $do$;

-- ── 1. The guard ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assert_manager_or_service()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN
    RETURN;
  END IF;
  IF NOT public.is_restaurant_manager() THEN
    RAISE EXCEPTION 'Managers only';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION assert_manager_or_service() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION assert_manager_or_service() TO authenticated;

-- ── 2. Guard shims for the Phase 1 manager RPCs ──────────────────────────
-- One canonical list drives rename + shim + revoke + the assertions below
-- (the 005 pattern). identity_args = types only (for to_regprocedure);
-- create_args = full parameter list WITH names and defaults (PostgREST
-- calls by named argument, so names must match the originals exactly);
-- call_args = pass-through.
CREATE TEMP TABLE _guard_shims (
  fname text PRIMARY KEY,
  identity_args text NOT NULL,
  create_args text NOT NULL,
  call_args text NOT NULL
) ON COMMIT DROP;
INSERT INTO _guard_shims VALUES
  ('pto_approve', 'uuid, jsonb',
   'p_request_id uuid, p_periods jsonb',
   'p_request_id, p_periods'),
  ('pto_deny', 'uuid, text',
   'p_request_id uuid, p_notes text DEFAULT NULL',
   'p_request_id, p_notes'),
  ('pto_unapprove', 'uuid',
   'p_request_id uuid',
   'p_request_id'),
  ('pto_adjust_balance', 'uuid, numeric, text',
   'p_employee_id uuid, p_delta numeric, p_notes text DEFAULT NULL',
   'p_employee_id, p_delta, p_notes'),
  ('tc_save', 'uuid, uuid, uuid, date, text, text, integer, numeric, text',
   'p_timecard_id uuid DEFAULT NULL, p_shift_id uuid DEFAULT NULL, p_employee_id uuid DEFAULT NULL, p_date date DEFAULT NULL, p_clock_in text DEFAULT NULL, p_clock_out text DEFAULT NULL, p_break_minutes int DEFAULT 0, p_training_hours numeric DEFAULT NULL, p_notes text DEFAULT NULL',
   'p_timecard_id, p_shift_id, p_employee_id, p_date, p_clock_in, p_clock_out, p_break_minutes, p_training_hours, p_notes'),
  ('tc_override', 'uuid, text, text, text',
   'p_timecard_id uuid, p_field text, p_value text, p_note text',
   'p_timecard_id, p_field, p_value, p_note'),
  ('tc_create_adhoc', 'uuid, date, text, text, integer, text',
   'p_employee_id uuid, p_date date, p_clock_in text DEFAULT NULL, p_clock_out text DEFAULT NULL, p_break_minutes int DEFAULT 0, p_notes text DEFAULT NULL',
   'p_employee_id, p_date, p_clock_in, p_clock_out, p_break_minutes, p_notes'),
  ('tc_set_status', 'uuid, text',
   'p_timecard_id uuid, p_to text',
   'p_timecard_id, p_to'),
  ('tc_add_note', 'uuid, text',
   'p_timecard_id uuid, p_note text',
   'p_timecard_id, p_note'),
  ('pay_post_period', 'date, date',
   'p_start date, p_end date',
   'p_start, p_end'),
  ('ts_add_large_party', 'uuid, numeric, uuid',
   'p_tip_sheet_id uuid, p_revenue numeric, p_manager_employee_id uuid DEFAULT NULL',
   'p_tip_sheet_id, p_revenue, p_manager_employee_id'),
  ('ts_reassign_manager', 'uuid, uuid',
   'p_lpr_id uuid, p_manager_employee_id uuid',
   'p_lpr_id, p_manager_employee_id'),
  ('ts_compute', 'uuid', 'p_tip_sheet_id uuid', 'p_tip_sheet_id'),
  ('ts_post', 'uuid', 'p_tip_sheet_id uuid', 'p_tip_sheet_id'),
  ('ts_unpost', 'uuid', 'p_tip_sheet_id uuid', 'p_tip_sheet_id'),
  ('swap_create', 'uuid, uuid, text',
   'p_shift_id uuid, p_new_employee_id uuid, p_notes text DEFAULT NULL',
   'p_shift_id, p_new_employee_id, p_notes'),
  ('swap_accept', 'uuid', 'p_swap_id uuid', 'p_swap_id'),
  ('swap_cancel', 'uuid', 'p_swap_id uuid', 'p_swap_id');

DO $do$
DECLARE
  r record;
  v_unguarded text;
BEGIN
  FOR r IN SELECT * FROM _guard_shims ORDER BY fname LOOP
    v_unguarded := r.fname || '_unguarded';

    -- First run: the live original gets renamed aside. Re-run: the rename
    -- already happened — skip. Neither present = the Phase 1 file was
    -- never applied: fail fast.
    IF to_regprocedure(format('public.%I(%s)', v_unguarded, r.identity_args)) IS NULL THEN
      IF to_regprocedure(format('public.%I(%s)', r.fname, r.identity_args)) IS NULL THEN
        RAISE EXCEPTION 'PREREQUISITE FAILED — %(%) not found; apply its Phase 1 file first',
          r.fname, r.identity_args;
      END IF;
      EXECUTE format('ALTER FUNCTION public.%I(%s) RENAME TO %I',
                     r.fname, r.identity_args, v_unguarded);
    END IF;

    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS jsonb
       LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $shim$
       BEGIN
         PERFORM public.assert_manager_or_service();
         RETURN public.%I(%s);
       END $shim$',
      r.fname, r.create_args, v_unguarded, r.call_args);

    -- Originals: nobody calls them directly anymore (the definer-owned
    -- shim still can — privilege is checked as the function owner).
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
                   v_unguarded, r.identity_args);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon',
                   r.fname, r.identity_args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated',
                   r.fname, r.identity_args);
  END LOOP;
END $do$;

-- Plumbing: block direct API calls; definer-internal callers unaffected.
DO $do$
BEGIN
  IF to_regprocedure('public.pto_recompute_balance(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.pto_recompute_balance(uuid) FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.pto_accrue_for_timecard(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.pto_accrue_for_timecard(uuid) FROM PUBLIC, anon, authenticated;
  END IF;
END $do$;

-- ── 3. tc_approve — full redefine ────────────────────────────────────────
-- Body from timecards.sql with three changes: the caller guard; the setup
-- thresholds read is tenant-filtered (the second and last `from setup`
-- offender); the audit actor is the ACTUAL caller (falling back to the
-- tenant's first manager for service_role calls).
CREATE OR REPLACE FUNCTION tc_approve(
  p_timecard_id    uuid,
  p_training_hours numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_actor    uuid;
  v_tc       timecards%rowtype;
  v_shift    shifts%rowtype;
  v_has_shift boolean := false;
  v_start_ts timestamptz;
  v_end_ts   timestamptz;
  v_actual   numeric;
  v_sched    numeric;
  v_week     numeric;
  v_reg      numeric;
  v_ot       numeric;
  v_train    numeric;
  v_late     numeric;
  v_tier     int := 0;
  v_disc     boolean := false;
  v_t1 int; v_t2 int; v_dth numeric;
  v_before jsonb; v_after jsonb;
begin
  perform public.assert_manager_or_service();

  v_actor := public.current_employee_id();
  if v_actor is null then
    select id into v_actor from employees
     where title = 'Restaurant Manager'
       and tenant_id = public.current_tenant_id()
     order by created_at limit 1;
  end if;
  if v_actor is null then raise exception 'No Restaurant Manager (actor) found'; end if;

  select * into v_tc from timecards where id = p_timecard_id;
  if not found then raise exception 'Timecard % not found', p_timecard_id; end if;
  if v_tc.status not in ('pending','reviewed') then
    raise exception 'Cannot approve a % timecard', v_tc.status;
  end if;
  if v_tc.clock_in is null or v_tc.clock_out is null then
    raise exception 'Clock in and clock out are required to approve';
  end if;

  -- thresholds come from setup, never hardcoded — tenant-filtered (014)
  select lateness_tier1_minutes, lateness_tier2_minutes, discrepancy_threshold_hours
    into v_t1, v_t2, v_dth
    from setup
   where tenant_id = public.current_tenant_id()
   order by updated_at desc nulls last limit 1;
  v_t1 := coalesce(v_t1, 12); v_t2 := coalesce(v_t2, 30); v_dth := coalesce(v_dth, 2);

  -- actual worked hours
  v_actual := extract(epoch from (v_tc.clock_out - v_tc.clock_in))/3600.0
              - coalesce(v_tc.break_minutes,0)/60.0;
  if v_actual < 0 then v_actual := 0; end if;

  -- weekly OT: ISO week (Mon-start), this employee's already-approved rows, excluding this one
  select coalesce(sum(coalesce(regular_hours,0) + coalesce(ot_hours,0)), 0)
    into v_week
    from timecards
   where employee_id = v_tc.employee_id
     and status in ('approved','posted')
     and id <> v_tc.id
     and date_trunc('week', date) = date_trunc('week', v_tc.date);

  v_reg := least(v_actual, greatest(0, 40 - v_week));
  v_ot  := greatest(0, v_actual - v_reg);

  v_train := coalesce(v_tc.training_hours, 0);

  if v_tc.shift_id is not null then
    select * into v_shift from shifts where id = v_tc.shift_id;
    v_has_shift := found;
  end if;

  if v_has_shift and v_shift.start_time is not null then
    v_start_ts := (v_tc.date::text || ' ' || v_shift.start_time::text)::timestamptz;
    v_late := greatest(0, extract(epoch from (v_tc.clock_in - v_start_ts))/60.0);
    if    v_late >= v_t2 then v_tier := 2;
    elsif v_late >= v_t1 then v_tier := 1;
    else  v_tier := 0;
    end if;

    if v_shift.end_time is not null then
      v_end_ts := (v_tc.date::text || ' ' || v_shift.end_time::text)::timestamptz;
      if v_end_ts <= v_start_ts then v_end_ts := v_end_ts + interval '1 day'; end if;
      v_sched := extract(epoch from (v_end_ts - v_start_ts))/3600.0;
      if abs(v_actual - v_sched) > v_dth then v_disc := true; end if;
    end if;
  end if;

  -- training_hours: is_training shift auto-populates worked hours; manual override wins
  if v_has_shift and coalesce(v_shift.is_training, false) then
    v_train := coalesce(p_training_hours, v_actual);
  elsif p_training_hours is not null then
    v_train := p_training_hours;
  end if;

  v_before := to_jsonb(v_tc);
  update timecards set
    status         = 'approved',
    regular_hours  = round(v_reg, 2),
    ot_hours       = round(v_ot, 2),
    training_hours = round(v_train, 2),
    discrepancy_flag = v_disc,
    lateness_tier  = v_tier,
    updated_at     = now()
  where id = p_timecard_id;
  select to_jsonb(t) into v_after from timecards t where id = p_timecard_id;

  insert into timecard_events (timecard_id, event_type, value_before, value_after, actor_id, notes)
  values (p_timecard_id, 'status_change', v_before, v_after, v_actor,
          format('Approved (reg=%s ot=%s train=%s tier=%s disc=%s)',
                 round(v_reg,2), round(v_ot,2), round(v_train,2), v_tier, v_disc));

  -- lateness_history is a thin pointer; one row per late approval (idempotent on re-approve)
  delete from lateness_history where timecard_id = p_timecard_id;
  if v_tier >= 1 then
    insert into lateness_history (employee_id, timecard_id, shift_id, date)
    values (v_tc.employee_id, p_timecard_id, v_tc.shift_id, v_tc.date);
  end if;

  return v_after;
end;
$$;
REVOKE ALL ON FUNCTION tc_approve(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tc_approve(uuid, numeric) TO authenticated;

-- ── 4. Tenant-table refresh (005 contract for the Phase 2 tables) ────────
CREATE INDEX IF NOT EXISTS coverage_requests_tenant_id_idx ON coverage_requests (tenant_id);
CREATE INDEX IF NOT EXISTS broadcasts_tenant_id_idx ON broadcasts (tenant_id);
CREATE INDEX IF NOT EXISTS broadcast_reads_tenant_id_idx ON broadcast_reads (tenant_id);
CREATE INDEX IF NOT EXISTS broadcast_replies_tenant_id_idx ON broadcast_replies (tenant_id);

-- 005-rev-2-style assertion: each table has NOT NULL tenant_id + a default
-- + only tenant-filtered policies.
DO $do$
DECLARE t text; bad text := '';
BEGIN
  FOREACH t IN ARRAY ARRAY['coverage_requests', 'broadcasts',
                           'broadcast_reads', 'broadcast_replies'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = t
        AND c.column_name = 'tenant_id'
        AND c.is_nullable = 'NO'
        AND c.column_default IS NOT NULL
    ) THEN
      bad := bad || t || ' (column) ';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t
        AND (p.qual IS NOT NULL AND p.qual NOT LIKE '%current_tenant_id%')
    ) THEN
      bad := bad || t || ' (policy) ';
    END IF;
  END LOOP;
  IF bad <> '' THEN
    RAISE EXCEPTION 'ASSERTION FAILED — tenant contract broken on: %', bad;
  END IF;
END $do$;

-- ── 5. Timezone ──────────────────────────────────────────────────────────
ALTER TABLE setup ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Los_Angeles';

CREATE OR REPLACE FUNCTION public.tenant_tz()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT timezone FROM setup
     WHERE tenant_id = public.current_tenant_id()
     ORDER BY updated_at DESC NULLS LAST LIMIT 1),
    'America/Los_Angeles');
$$;

CREATE OR REPLACE FUNCTION public.tenant_today()
RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (now() AT TIME ZONE public.tenant_tz())::date;
$$;

-- Wall-clock (date, time) in the tenant's timezone → absolute instant.
CREATE OR REPLACE FUNCTION public.shift_start_at(p_date date, p_start time)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (p_date + coalesce(p_start, time '00:00')) AT TIME ZONE public.tenant_tz();
$$;

REVOKE ALL ON FUNCTION tenant_tz() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION tenant_today() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION shift_start_at(date, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tenant_tz() TO authenticated;
GRANT EXECUTE ON FUNCTION tenant_today() TO authenticated;
GRANT EXECUTE ON FUNCTION shift_start_at(date, time) TO authenticated;

-- 5a. callout_submit (010 body; "today" is now tenant-local — the UTC date
-- wrongly rejected same-day callouts after 5pm PT).
CREATE OR REPLACE FUNCTION callout_submit(
  p_shift_id uuid,
  p_reason text,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_shift shifts%rowtype;
  v_callout uuid;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('Sick', 'Emergency', 'Personal', 'Other') THEN
    RAISE EXCEPTION 'Invalid reason';
  END IF;
  IF p_notes IS NOT NULL AND char_length(p_notes) > 200 THEN
    RAISE EXCEPTION 'Notes must be 200 characters or fewer';
  END IF;

  SELECT * INTO v_shift FROM shifts
   WHERE id = p_shift_id
     AND employee_id = v_emp
     AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;
  IF v_shift.date IS NULL OR v_shift.date < public.tenant_today() THEN
    RAISE EXCEPTION 'Cannot call out on a past shift';
  END IF;
  IF EXISTS (
    SELECT 1 FROM callout_history
    WHERE shift_id = p_shift_id AND employee_id = v_emp
  ) THEN
    RAISE EXCEPTION 'You already called out for this shift';
  END IF;

  INSERT INTO callout_history
    (employee_id, shift_id, date, reason, notes, status, entered_by, tenant_id)
  VALUES
    (v_emp, p_shift_id, v_shift.date, p_reason, p_notes, 'open', v_emp,
     public.current_tenant_id())
  RETURNING id INTO v_callout;

  INSERT INTO coverage_requests (callout_id, shift_id, status, tenant_id)
  VALUES (v_callout, p_shift_id, 'open', public.current_tenant_id());

  RETURN v_callout;
END;
$$;

-- 5b. employee_eligible_for_coverage (010 body; tenant-local "today").
CREATE OR REPLACE FUNCTION public.employee_eligible_for_coverage(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM coverage_requests cr
    JOIN callout_history c ON c.id = cr.callout_id
    JOIN shifts s          ON s.id = cr.shift_id
    JOIN employees caller  ON caller.id = c.employee_id
    JOIN employees me      ON me.id = public.current_employee_id()
    WHERE cr.id = p_request_id
      AND cr.tenant_id = public.current_tenant_id()
      AND me.id <> caller.id
      AND s.date >= public.tenant_today()
      AND ((me.department_id IS NOT NULL AND me.department_id = caller.department_id)
           OR (me.department IS NOT NULL AND me.department = caller.department))
      AND s.outlet_id IS NOT NULL
      AND (me.home_outlet_id = s.outlet_id
           OR EXISTS (SELECT 1 FROM employee_outlets eo
                      WHERE eo.employee_id = me.id AND eo.outlet_id = s.outlet_id)
           OR EXISTS (SELECT 1 FROM shifts sx
                      WHERE sx.employee_id = me.id AND sx.outlet_id = s.outlet_id))
      AND NOT EXISTS (
        SELECT 1 FROM shifts s2
        WHERE s2.employee_id = me.id
          AND s2.date = s.date
          AND (s.start_time IS NULL OR s.end_time IS NULL
               OR s2.start_time IS NULL OR s2.end_time IS NULL
               OR (s2.start_time < s.end_time AND s.start_time < s2.end_time))
      )
  );
$$;

-- 5c. swap_request_submit (011 rev 2 body; exact 24h cutoff in tenant tz
-- on BOTH sides of the trade).
CREATE OR REPLACE FUNCTION swap_request_submit(
  p_my_shift_id uuid,
  p_target_employee_id uuid,
  p_target_shift_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_shift shifts%rowtype;
  v_their shifts%rowtype;
  v_id uuid;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  IF p_target_employee_id IS NULL THEN
    RAISE EXCEPTION 'A teammate to swap with is required';
  END IF;

  SELECT * INTO v_shift FROM shifts
   WHERE id = p_my_shift_id
     AND employee_id = v_emp
     AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;
  IF v_shift.date IS NULL THEN
    RAISE EXCEPTION 'This shift has no date — ask your manager to fix it';
  END IF;

  -- Adèle's rule, now in the tenant's own clock (014).
  IF public.shift_start_at(v_shift.date, v_shift.start_time)
     < now() + interval '24 hours' THEN
    RAISE EXCEPTION 'Swaps must be requested at least 24 hours before the shift';
  END IF;

  IF NOT public.employee_eligible_for_swap(p_my_shift_id, p_target_employee_id) THEN
    RAISE EXCEPTION 'That teammate is not eligible for this swap (same position, same outlet, and free during the shift required)';
  END IF;

  IF p_target_shift_id IS NOT NULL THEN
    SELECT * INTO v_their FROM shifts
     WHERE id = p_target_shift_id
       AND employee_id = p_target_employee_id
       AND tenant_id = public.current_tenant_id();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected shift does not belong to that teammate';
    END IF;
    IF v_their.date IS NULL
       OR public.shift_start_at(v_their.date, v_their.start_time)
          < now() + interval '24 hours' THEN
      RAISE EXCEPTION 'Their shift is less than 24 hours away — pick another';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM swap_history
    WHERE shift_id = p_my_shift_id
      AND status IN ('pending', 'pending_target', 'pending_manager')
  ) THEN
    RAISE EXCEPTION 'You already have a pending swap for this shift';
  END IF;

  INSERT INTO swap_history
    (shift_id, original_employee_id, new_employee_id, target_shift_id,
     status, swapped_by, tenant_id)
  VALUES
    (p_my_shift_id, v_emp, p_target_employee_id, p_target_shift_id,
     'pending_target', v_emp, public.current_tenant_id())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 5d. employee_eligible_for_swap (011 body; tenant-local "today").
CREATE OR REPLACE FUNCTION public.employee_eligible_for_swap(
  p_shift_id uuid,
  p_candidate_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM shifts s
    JOIN employees c ON c.id = p_candidate_id
    WHERE s.id = p_shift_id
      AND s.tenant_id = public.current_tenant_id()
      AND c.tenant_id = public.current_tenant_id()
      AND c.termination_date IS NULL
      AND c.id <> s.employee_id
      AND s.position IS NOT NULL
      AND coalesce(c.home_position, c.position) = s.position
      AND s.outlet_id IS NOT NULL
      AND (c.home_outlet_id = s.outlet_id
           OR EXISTS (SELECT 1 FROM employee_outlets eo
                      WHERE eo.employee_id = c.id AND eo.outlet_id = s.outlet_id)
           OR EXISTS (SELECT 1 FROM shifts sx
                      WHERE sx.employee_id = c.id AND sx.outlet_id = s.outlet_id))
      AND NOT EXISTS (
        SELECT 1 FROM shifts s2
        WHERE s2.employee_id = c.id
          AND s2.date = s.date
          AND (s.start_time IS NULL OR s.end_time IS NULL
               OR s2.start_time IS NULL OR s2.end_time IS NULL
               OR (s2.start_time < s.end_time AND s.start_time < s2.end_time))
      )
  );
$$;

-- 5e. swap_eligible_teammates (011 body; the candidate window uses the same
-- tenant-tz cutoff as submit, so the list and the gate stay consistent).
DROP FUNCTION IF EXISTS swap_eligible_teammates(uuid);

CREATE OR REPLACE FUNCTION swap_eligible_teammates(p_shift_id uuid)
RETURNS TABLE (
  employee_id uuid,
  employee_name text,
  employee_position text,
  shift_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  shift_position text,
  outlet_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_shift shifts%rowtype;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;

  SELECT sh.* INTO v_shift FROM shifts sh
   WHERE sh.id = p_shift_id
     AND sh.employee_id = v_emp
     AND sh.tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;

  RETURN QUERY
  SELECT e.id,
         trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')),
         coalesce(e.home_position, e.position),
         cs.id, cs.date, cs.start_time, cs.end_time, cs.position, o.name
  FROM employees e
  LEFT JOIN shifts cs
    ON cs.employee_id = e.id
   AND cs.date BETWEEN public.tenant_today() AND public.tenant_today() + 14
   AND public.shift_start_at(cs.date, cs.start_time) >= now() + interval '24 hours'
  LEFT JOIN outlets o ON o.id = cs.outlet_id
  WHERE e.tenant_id = public.current_tenant_id()
    AND public.employee_eligible_for_swap(p_shift_id, e.id)
  ORDER BY 2, cs.date NULLS LAST, cs.start_time NULLS LAST;
END;
$$;
REVOKE ALL ON FUNCTION swap_eligible_teammates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION swap_eligible_teammates(uuid) TO authenticated;

-- ── 6. pay_breakdown — tenant-filtered setup read (017 body otherwise) ───
CREATE OR REPLACE FUNCTION pay_breakdown(
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
LANGUAGE sql STABLE AS $$
  with mode as (select lower(coalesce(p_mode, 'actual')) as m),
  -- Salary periods-per-year from the configured pay cycle — TENANT-FILTERED
  -- (014): under pay_breakdown_for_me's SECURITY DEFINER delegation the old
  -- `limit 1` could read another tenant's setup row.
  ppy as (
    select case lower(coalesce((select pay_cycle from setup
                                where tenant_id = public.current_tenant_id()
                                limit 1), 'biweekly'))
             when 'weekly' then 52
             when 'biweekly' then 26
             when 'semimonthly' then 24
             when 'monthly' then 12
             else 26 end as n
  ),
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
      coalesce(e.pay_type, 'hourly') as pay_type,
      e.annual_salary,
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
      b.ot_rate as ot_rate_eff
    from base b
  ),
  pays as (
    select c.*,
      case when c.pay_type = 'salary'
             then case when c.annual_salary is null then null
                       else round(c.annual_salary / (select n from ppy), 2) end
           when c.reg_used = 0 then 0
           when c.regular_rate is null then null
           else round(c.reg_used * c.regular_rate, 2) end as regular_pay,
      case when c.pay_type = 'salary' then 0
           when c.ot_hours = 0 then 0
           when c.ot_rate_eff is null then null
           else round(c.ot_hours * c.ot_rate_eff, 2) end as ot_pay,
      case when c.pay_type = 'salary' then 0
           when c.training_hours = 0 then 0
           when c.training_rate is null then null
           else round(c.training_hours * c.training_rate, 2) end as training_pay,
      case when c.pay_type = 'salary' then 0
           when c.pto_hours = 0 then 0
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
    case when (p.regular_pay is null or p.ot_pay is null or p.training_pay is null or p.pto_pay is null)
         then null
         else round(coalesce(p.regular_pay,0) + coalesce(p.ot_pay,0)
                  + coalesce(p.training_pay,0) + coalesce(p.pto_pay,0) + p.tip_pay, 2)
    end as gross_pay,
    (p.regular_pay is null or p.ot_pay is null or p.training_pay is null or p.pto_pay is null) as has_missing_rate,
    (
      array_remove(array[
        case when p.pay_type = 'salary' then
               case when p.annual_salary is null then 'Missing annual salary' end
             else case when p.regular_pay is null then 'Missing regular rate' end end,
        case when p.pay_type <> 'salary' and p.ot_pay is null      then 'Missing OT rate' end,
        case when p.pay_type <> 'salary' and p.training_pay is null then 'Missing training rate' end,
        case when p.pay_type <> 'salary' and p.pto_pay is null     then 'Missing PTO rate' end
      ], null)
    ) as warnings,
    p.pay_type
  from pays p
  order by p.first_name, p.last_name;
$$;

-- ── 7. Fail-fast assertions ──────────────────────────────────────────────
DO $do$
DECLARE
  r record;
  v_def text;
BEGIN
  -- Every shim guards; every original is renamed + fully revoked.
  FOR r IN SELECT fname, identity_args FROM _guard_shims LOOP
    v_def := pg_get_functiondef(to_regprocedure(format('public.%I(%s)', r.fname, r.identity_args)));
    IF v_def NOT LIKE '%assert_manager_or_service%' THEN
      RAISE EXCEPTION 'ASSERTION FAILED — % is not guarded', r.fname;
    END IF;
    IF to_regprocedure(format('public.%I(%s)', r.fname || '_unguarded', r.identity_args)) IS NULL THEN
      RAISE EXCEPTION 'ASSERTION FAILED — %_unguarded missing', r.fname;
    END IF;
    IF has_function_privilege('authenticated',
         to_regprocedure(format('public.%I(%s)', r.fname || '_unguarded', r.identity_args)),
         'EXECUTE') THEN
      RAISE EXCEPTION 'ASSERTION FAILED — %_unguarded still executable by authenticated', r.fname;
    END IF;
  END LOOP;

  -- tc_approve: guarded + tenant-filtered setup.
  v_def := pg_get_functiondef('public.tc_approve(uuid, numeric)'::regprocedure);
  IF v_def NOT LIKE '%assert_manager_or_service%'
     OR v_def NOT LIKE '%tenant_id = public.current_tenant_id()%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED — tc_approve not hardened';
  END IF;

  -- Plumbing revoked.
  IF has_function_privilege('authenticated', 'public.pto_recompute_balance(uuid)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.pto_accrue_for_timecard(uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED — plumbing functions still executable by authenticated';
  END IF;

  -- Timezone plumbing in place.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'setup'
      AND column_name = 'timezone' AND is_nullable = 'NO'
      AND column_default LIKE '%America/Los_Angeles%'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED — setup.timezone missing or defaultless';
  END IF;
  IF pg_get_functiondef('public.swap_request_submit(uuid, uuid, uuid)'::regprocedure)
       NOT LIKE '%shift_start_at%'
     OR pg_get_functiondef('public.callout_submit(uuid, text, text)'::regprocedure)
       NOT LIKE '%tenant_today%'
     OR pg_get_functiondef('public.swap_eligible_teammates(uuid)'::regprocedure)
       NOT LIKE '%shift_start_at%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED — timezone-aware redefinitions missing';
  END IF;

  -- Pay engine tenant filter.
  IF pg_get_functiondef('public.pay_breakdown(date, date, text)'::regprocedure)
       NOT LIKE '%where tenant_id = public.current_tenant_id()%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED — pay_breakdown setup read not tenant-filtered';
  END IF;

  -- 008's drift alarm still holds after the redefine.
  IF pg_get_function_result('public.pay_breakdown(date, date, text)'::regprocedure)
     IS DISTINCT FROM
     pg_get_function_result('public.pay_breakdown_for_me(date, date, text)'::regprocedure) THEN
    RAISE EXCEPTION 'ASSERTION FAILED — pay_breakdown result signature drifted from pay_breakdown_for_me';
  END IF;
END $do$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run after COMMIT) ──────────────────────────────────────
-- 18 shims + 18 renamed originals:
SELECT proname FROM pg_proc
WHERE proname LIKE '%\_unguarded' ORDER BY proname;
-- All guarded (18 shims + tc_approve = 19 rows):
SELECT p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'  -- plain functions only (pg_get_functiondef raises on aggregates)
  AND pg_get_functiondef(p.oid) LIKE '%assert_manager_or_service%'
  AND p.proname NOT LIKE '%unguarded'
  AND p.proname <> 'assert_manager_or_service'
ORDER BY p.proname;
-- setup.timezone:
SELECT column_name, column_default FROM information_schema.columns
WHERE table_name = 'setup' AND column_name = 'timezone';
-- Tenant indexes on the Phase 2 tables:
SELECT indexname FROM pg_indexes WHERE indexname IN
  ('coverage_requests_tenant_id_idx', 'broadcasts_tenant_id_idx',
   'broadcast_reads_tenant_id_idx', 'broadcast_replies_tenant_id_idx');
-- Smoke test — from a signed-in EMPLOYEE client, every guarded RPC now
-- raises 'Managers only' (e.g. supabase.rpc('pto_approve', ...)); from the
-- manager account everything behaves exactly as before.

-- ── Rollback (run by hand only — restores the unguarded originals) ───────
-- BEGIN;
-- -- for each shim: DROP FUNCTION <name>(<args>);
-- --                ALTER FUNCTION <name>_unguarded(<args>) RENAME TO <name>;
-- --                GRANT EXECUTE ON FUNCTION <name>(<args>) TO authenticated;
-- -- plus: GRANT EXECUTE back on pto_recompute_balance / pto_accrue_for_timecard;
-- -- re-apply timecards.sql (tc_approve), 010 (callout/coverage fns),
-- -- 011 (swap fns), 017 (pay_breakdown) to restore pre-014 definitions;
-- -- ALTER TABLE setup DROP COLUMN timezone;
-- -- DROP FUNCTION shift_start_at(date, time); DROP FUNCTION tenant_today();
-- -- DROP FUNCTION tenant_tz(); DROP FUNCTION assert_manager_or_service();
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';

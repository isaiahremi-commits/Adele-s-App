-- =========================================================================
-- Migration 025 (Phase 2 PR #27) — punch-level break tracking on timecards.
-- Run in the Supabase SQL editor AFTER the applied chain (needs 014's
-- guard shims + 005 helpers). Idempotent; safe to re-run.
--
-- Adds break1_in/out + break2_in/out (timestamptz) to timecards; tc_save
-- gains four optional punch params (signature change — both the 014 shim
-- and tc_save_unguarded are dropped and re-created; PostgREST named calls
-- from existing clients keep resolving because the new params default to
-- NULL). When a punch is supplied, break_minutes is DERIVED from the
-- complete break spans so tc_approve's hours math keeps working untouched.
--
-- tc_break_punch: the first EMPLOYEE-callable punch RPC. Mobile has no
-- clock-in flow yet (NFC clock-in is a future item), so the break button
-- can't hang off "after clock-in" as the spec assumed — instead the RPC
-- finds the caller's own pending/reviewed timecard for a today-shift and
-- creates a bare pending one (no clock times) if none exists; the web
-- Timecards page already renders exactly that state as "pending, missing
-- punches". Stamps break1_in → break1_out → break2_in → break2_out in
-- order, recomputing break_minutes on each completed span.
--
-- Backfill: best-effort, non-destructive — rows with break_minutes > 0,
-- both clocks set, and no punch data get break1 synthesized symmetrically
-- around the shift midpoint.
-- =========================================================================

BEGIN;

-- ── 0. Fail fast ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.current_tenant_id()') IS NULL
     OR to_regprocedure('public.current_employee_id()') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — apply 005/007 first';
  END IF;
  IF to_regprocedure('public.assert_manager_or_service()') IS NULL
     OR (to_regprocedure('public.tc_save_unguarded(uuid, uuid, uuid, date, text, text, int, numeric, text)') IS NULL
         -- re-run: the first apply already swapped in the 13-param version
         AND to_regprocedure('public.tc_save_unguarded(uuid, uuid, uuid, date, text, text, int, numeric, text, timestamptz, timestamptz, timestamptz, timestamptz)') IS NULL) THEN
    RAISE EXCEPTION 'PREREQ FAILED — 014''s tc_save guard shim not found; apply 014 first';
  END IF;
END $$;

-- ── 1. Columns ───────────────────────────────────────────────────────────
ALTER TABLE timecards ADD COLUMN IF NOT EXISTS break1_in  timestamptz;
ALTER TABLE timecards ADD COLUMN IF NOT EXISTS break1_out timestamptz;
ALTER TABLE timecards ADD COLUMN IF NOT EXISTS break2_in  timestamptz;
ALTER TABLE timecards ADD COLUMN IF NOT EXISTS break2_out timestamptz;

-- ── 2. tc_save with punch params (signature change ⇒ drop + recreate both
--       halves of the 014 shim pair; grants restored identically) ─────────
DROP FUNCTION IF EXISTS public.tc_save(uuid, uuid, uuid, date, text, text, int, numeric, text);
DROP FUNCTION IF EXISTS public.tc_save(uuid, uuid, uuid, date, text, text, int, numeric, text, timestamptz, timestamptz, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.tc_save_unguarded(uuid, uuid, uuid, date, text, text, int, numeric, text);
DROP FUNCTION IF EXISTS public.tc_save_unguarded(uuid, uuid, uuid, date, text, text, int, numeric, text, timestamptz, timestamptz, timestamptz, timestamptz);

CREATE FUNCTION public.tc_save_unguarded(
  p_timecard_id   uuid    DEFAULT NULL,
  p_shift_id      uuid    DEFAULT NULL,
  p_employee_id   uuid    DEFAULT NULL,
  p_date          date    DEFAULT NULL,
  p_clock_in      text    DEFAULT NULL,   -- 'HH:MM' (wall time on p_date)
  p_clock_out     text    DEFAULT NULL,
  p_break_minutes int     DEFAULT 0,
  p_training_hours numeric DEFAULT NULL,
  p_notes         text    DEFAULT NULL,
  -- 025: punch-level breaks. Coalesce-preserving (like break_minutes) —
  -- passing NULL leaves an existing punch alone; tc_override clears.
  p_break1_in     timestamptz DEFAULT NULL,
  p_break1_out    timestamptz DEFAULT NULL,
  p_break2_in     timestamptz DEFAULT NULL,
  p_break2_out    timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_actor    uuid;
  v_old      timecards%rowtype;
  v_id       uuid;
  v_ci       timestamptz;
  v_co       timestamptz;
  v_date     date;
  v_before   jsonb;
  v_after    jsonb;
  v_type     text;
  v_punch    boolean := (p_break1_in IS NOT NULL OR p_break1_out IS NOT NULL
                         OR p_break2_in IS NOT NULL OR p_break2_out IS NOT NULL);
  v_b1i timestamptz; v_b1o timestamptz; v_b2i timestamptz; v_b2o timestamptz;
  v_break_min int;
begin
  select id into v_actor from employees where title = 'Restaurant Manager' order by created_at limit 1;
  if v_actor is null then raise exception 'No Restaurant Manager (actor) found'; end if;

  if p_timecard_id is not null then
    select * into v_old from timecards where id = p_timecard_id;
    if not found then raise exception 'Timecard % not found', p_timecard_id; end if;
    if v_old.status not in ('pending','reviewed') then
      raise exception 'Cannot edit a % timecard — use override', v_old.status;
    end if;
    v_date := coalesce(p_date, v_old.date);
  else
    if p_date is not null then
      v_date := p_date;
    elsif p_shift_id is not null then
      select date into v_date from shifts where id = p_shift_id;
    end if;
    if v_date is null then raise exception 'A date is required'; end if;
  end if;

  v_ci := case when p_clock_in  is not null and p_clock_in  <> '' then (v_date::text || ' ' || p_clock_in )::timestamptz end;
  v_co := case when p_clock_out is not null and p_clock_out <> '' then (v_date::text || ' ' || p_clock_out)::timestamptz end;
  if v_ci is not null and v_co is not null and v_co < v_ci then
    v_co := v_co + interval '1 day';   -- overnight shift
  end if;

  -- Effective punch values after coalesce; when any punch was supplied,
  -- break_minutes is derived from the COMPLETE spans (in-progress breaks
  -- contribute nothing until their out-punch lands).
  v_b1i := coalesce(p_break1_in,  case when p_timecard_id is not null then v_old.break1_in  end);
  v_b1o := coalesce(p_break1_out, case when p_timecard_id is not null then v_old.break1_out end);
  v_b2i := coalesce(p_break2_in,  case when p_timecard_id is not null then v_old.break2_in  end);
  v_b2o := coalesce(p_break2_out, case when p_timecard_id is not null then v_old.break2_out end);
  if v_punch then
    v_break_min := coalesce(
        (case when v_b1i is not null and v_b1o is not null and v_b1o > v_b1i
              then extract(epoch from (v_b1o - v_b1i)) / 60.0 else 0 end
       + case when v_b2i is not null and v_b2o is not null and v_b2o > v_b2i
              then extract(epoch from (v_b2o - v_b2i)) / 60.0 else 0 end)::int, 0);
  end if;

  if p_timecard_id is null then
    if p_employee_id is null and p_shift_id is not null then
      select employee_id into p_employee_id from shifts where id = p_shift_id;
    end if;
    if p_employee_id is null then raise exception 'An employee is required'; end if;

    insert into timecards (employee_id, shift_id, date, clock_in, clock_out,
                           break_minutes, training_hours, notes, status, updated_at,
                           break1_in, break1_out, break2_in, break2_out)
    values (p_employee_id, p_shift_id, v_date, v_ci, v_co,
            case when v_punch then v_break_min else coalesce(p_break_minutes,0) end,
            coalesce(p_training_hours,0), p_notes, 'pending', now(),
            p_break1_in, p_break1_out, p_break2_in, p_break2_out)
    returning id into v_id;

    select to_jsonb(t) into v_after from timecards t where id = v_id;
    insert into timecard_events (timecard_id, event_type, value_before, value_after, actor_id, notes)
    values (v_id, 'clock_in', null, v_after, v_actor, 'Timecard created');
  else
    v_before := jsonb_build_object(
      'clock_in', v_old.clock_in, 'clock_out', v_old.clock_out,
      'break_minutes', v_old.break_minutes, 'training_hours', v_old.training_hours,
      'notes', v_old.notes,
      'break1_in', v_old.break1_in, 'break1_out', v_old.break1_out,
      'break2_in', v_old.break2_in, 'break2_out', v_old.break2_out);

    update timecards set
      clock_in       = v_ci,
      clock_out      = v_co,
      break_minutes  = case when v_punch then v_break_min
                            else coalesce(p_break_minutes, break_minutes) end,
      training_hours = coalesce(p_training_hours, training_hours),
      notes          = p_notes,
      break1_in      = v_b1i,
      break1_out     = v_b1o,
      break2_in      = v_b2i,
      break2_out     = v_b2o,
      updated_at     = now()
    where id = p_timecard_id
    returning id into v_id;

    v_after := jsonb_build_object(
      'clock_in', v_ci, 'clock_out', v_co,
      'break_minutes', case when v_punch then v_break_min else coalesce(p_break_minutes, v_old.break_minutes) end,
      'training_hours', coalesce(p_training_hours, v_old.training_hours),
      'notes', p_notes,
      'break1_in', v_b1i, 'break1_out', v_b1o, 'break2_in', v_b2i, 'break2_out', v_b2o);

    if    v_old.clock_in  is distinct from v_ci then v_type := 'clock_in';
    elsif v_old.clock_out is distinct from v_co then v_type := 'clock_out';
    elsif v_old.notes     is distinct from p_notes then v_type := 'note';
    else  v_type := 'clock_in';
    end if;

    insert into timecard_events (timecard_id, event_type, value_before, value_after, actor_id, notes)
    values (v_id, v_type, v_before, v_after, v_actor, null);
  end if;

  return (select to_jsonb(t) from timecards t where id = v_id);
end;
$$;

-- The guard shim, exactly per 014's architecture.
CREATE FUNCTION public.tc_save(
  p_timecard_id   uuid    DEFAULT NULL,
  p_shift_id      uuid    DEFAULT NULL,
  p_employee_id   uuid    DEFAULT NULL,
  p_date          date    DEFAULT NULL,
  p_clock_in      text    DEFAULT NULL,
  p_clock_out     text    DEFAULT NULL,
  p_break_minutes int     DEFAULT 0,
  p_training_hours numeric DEFAULT NULL,
  p_notes         text    DEFAULT NULL,
  p_break1_in     timestamptz DEFAULT NULL,
  p_break1_out    timestamptz DEFAULT NULL,
  p_break2_in     timestamptz DEFAULT NULL,
  p_break2_out    timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_manager_or_service();
  RETURN public.tc_save_unguarded(
    p_timecard_id, p_shift_id, p_employee_id, p_date, p_clock_in, p_clock_out,
    p_break_minutes, p_training_hours, p_notes,
    p_break1_in, p_break1_out, p_break2_in, p_break2_out);
END;
$$;

REVOKE ALL ON FUNCTION public.tc_save_unguarded(uuid, uuid, uuid, date, text, text, int, numeric, text, timestamptz, timestamptz, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tc_save(uuid, uuid, uuid, date, text, text, int, numeric, text, timestamptz, timestamptz, timestamptz, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tc_save(uuid, uuid, uuid, date, text, text, int, numeric, text, timestamptz, timestamptz, timestamptz, timestamptz)
  TO authenticated;

-- ── 3. tc_break_punch: employee-callable start/end break ─────────────────
CREATE OR REPLACE FUNCTION public.tc_break_punch(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_emp    uuid := public.current_employee_id();
  v_shift  shifts%rowtype;
  v_today  date;
  v_tc     timecards%rowtype;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant on your session'; END IF;
  IF v_emp IS NULL THEN RAISE EXCEPTION 'No employee record is linked to your account'; END IF;

  SELECT * INTO v_shift FROM shifts s
   WHERE s.id = p_shift_id AND s.tenant_id = v_tenant AND s.employee_id = v_emp;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found'; END IF;

  v_today := (now() AT TIME ZONE coalesce(
    (SELECT st.timezone FROM setup st WHERE st.tenant_id = v_tenant LIMIT 1),
    'America/Los_Angeles'))::date;
  IF v_shift.date IS DISTINCT FROM v_today THEN
    RAISE EXCEPTION 'Breaks can only be punched on today''s shift';
  END IF;

  -- The caller's own editable timecard for this shift/day; create a bare
  -- pending one if the manager hasn't started it yet (the web Timecards
  -- page already renders that as "pending, missing punches").
  SELECT * INTO v_tc FROM timecards t
   WHERE t.employee_id = v_emp
     AND (t.shift_id = p_shift_id OR (t.shift_id IS NULL AND t.date = v_shift.date))
     AND t.status IN ('pending','reviewed')
   ORDER BY (t.shift_id = p_shift_id) DESC, t.created_at
   LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO timecards (employee_id, shift_id, date, status, break_minutes, tenant_id)
    VALUES (v_emp, p_shift_id, v_shift.date, 'pending', 0, v_tenant)
    RETURNING * INTO v_tc;
  END IF;

  IF v_tc.break1_in IS NULL THEN
    UPDATE timecards SET break1_in = now(), updated_at = now() WHERE id = v_tc.id;
  ELSIF v_tc.break1_out IS NULL THEN
    UPDATE timecards SET break1_out = now(),
      break_minutes = greatest(0, round(extract(epoch from (now() - break1_in)) / 60.0))::int,
      updated_at = now() WHERE id = v_tc.id;
  ELSIF v_tc.break2_in IS NULL THEN
    UPDATE timecards SET break2_in = now(), updated_at = now() WHERE id = v_tc.id;
  ELSIF v_tc.break2_out IS NULL THEN
    UPDATE timecards SET break2_out = now(),
      break_minutes = greatest(0, round(extract(epoch from (break1_out - break1_in)) / 60.0)
                                + round(extract(epoch from (now() - break2_in)) / 60.0))::int,
      updated_at = now() WHERE id = v_tc.id;
  ELSE
    RAISE EXCEPTION 'Both breaks are already recorded for this shift';
  END IF;

  RETURN (SELECT to_jsonb(t) FROM timecards t WHERE t.id = v_tc.id);
END;
$$;
REVOKE ALL ON FUNCTION public.tc_break_punch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tc_break_punch(uuid) TO authenticated;

-- ── 4. Backfill (best-effort, non-destructive) ───────────────────────────
-- Synthesize break1 symmetrically around the shift midpoint for rows that
-- have a positive break_minutes, both clocks, and no punch data yet.
UPDATE timecards
SET break1_in  = clock_in  + (clock_out - clock_in) / 2 - ((break_minutes || ' minutes')::interval / 2),
    break1_out = clock_in  + (clock_out - clock_in) / 2 + ((break_minutes || ' minutes')::interval / 2)
WHERE break_minutes > 0
  AND clock_in IS NOT NULL AND clock_out IS NOT NULL AND clock_out > clock_in
  AND break1_in IS NULL AND break1_out IS NULL
  AND break2_in IS NULL AND break2_out IS NULL;

-- ── 5. Assertions ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'timecards'
        AND column_name IN ('break1_in','break1_out','break2_in','break2_out')) <> 4 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — break punch columns missing';
  END IF;
  IF to_regprocedure('public.tc_save(uuid, uuid, uuid, date, text, text, int, numeric, text, timestamptz, timestamptz, timestamptz, timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — extended tc_save missing';
  END IF;
  IF to_regprocedure('public.tc_save(uuid, uuid, uuid, date, text, text, int, numeric, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — old tc_save overload still present (PostgREST would be ambiguous)';
  END IF;
  IF to_regprocedure('public.tc_break_punch(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — tc_break_punch missing';
  END IF;
  IF has_function_privilege('authenticated', 'public.tc_save_unguarded(uuid, uuid, uuid, date, text, text, int, numeric, text, timestamptz, timestamptz, timestamptz, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED — tc_save_unguarded reachable from the API';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.tc_break_punch(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED — tc_break_punch not employee-callable';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run by hand after applying) ────────────────────────────
-- 1. Legacy row got a synthesized break:
--    SELECT id, break_minutes, break1_in, break1_out FROM timecards
--    WHERE break_minutes > 0 ORDER BY updated_at DESC LIMIT 5;
-- 2. As an employee with a shift today: SELECT public.tc_break_punch('<shift-uuid>');
--    (twice → break1_in + break1_out set, break_minutes recomputed)
-- 3. tc_save still resolves from the web Timecards page (save any row).

-- ── Rollback (run by hand only) ──────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.tc_break_punch(uuid);
-- (restore 9-param tc_save/tc_save_unguarded from timecards.sql + 014)
-- ALTER TABLE timecards DROP COLUMN IF EXISTS break1_in, DROP COLUMN IF EXISTS break1_out,
--   DROP COLUMN IF EXISTS break2_in, DROP COLUMN IF EXISTS break2_out;

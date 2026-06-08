-- =========================================================================
-- Manadele — Timecards feature (Tier 1, item #1)
-- Run this in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Depends on Migration 001 tables/columns:
--   timecards, timecard_events, lateness_history, shifts.is_training/is_event,
--   setup.lateness_tier1_minutes / lateness_tier2_minutes / discrepancy_threshold_hours,
--   employees.first_name / last_name / title.
--
-- All multi-table writes (Save, Approve, Override, ad-hoc create, status, note)
-- run inside a single function body == one transaction. Thresholds are read
-- from the `setup` table, never hardcoded.
-- =========================================================================

-- Phase 1 runs open (no RLS). Make sure anon REST + RPC reach the tables.
alter table timecards         disable row level security;
alter table timecard_events   disable row level security;
alter table lateness_history  disable row level security;

-- Audit actor: Adèle Chappuis as Restaurant Manager.
-- The Migration 001 backfill did not populate any title; create her row here
-- if (and only if) no Restaurant Manager exists yet.
insert into employees (first_name, last_name, title)
select 'Adèle', 'Chappuis', 'Restaurant Manager'
where not exists (select 1 from employees where title = 'Restaurant Manager');


-- -------------------------------------------------------------------------
-- tc_save: create-or-update a timecard pre-approval, capturing the diff.
-- Never writes lateness_tier / discrepancy_flag / regular_hours / ot_hours.
-- -------------------------------------------------------------------------
create or replace function tc_save(
  p_timecard_id   uuid    default null,
  p_shift_id      uuid    default null,
  p_employee_id   uuid    default null,
  p_date          date    default null,
  p_clock_in      text    default null,   -- 'HH:MM' (wall time on p_date)
  p_clock_out     text    default null,
  p_break_minutes int     default 0,
  p_training_hours numeric default null,
  p_notes         text    default null
) returns jsonb
language plpgsql security definer as $$
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

  if p_timecard_id is null then
    if p_employee_id is null and p_shift_id is not null then
      select employee_id into p_employee_id from shifts where id = p_shift_id;
    end if;
    if p_employee_id is null then raise exception 'An employee is required'; end if;

    insert into timecards (employee_id, shift_id, date, clock_in, clock_out,
                           break_minutes, training_hours, notes, status, updated_at)
    values (p_employee_id, p_shift_id, v_date, v_ci, v_co,
            coalesce(p_break_minutes,0), coalesce(p_training_hours,0), p_notes, 'pending', now())
    returning id into v_id;

    select to_jsonb(t) into v_after from timecards t where id = v_id;
    insert into timecard_events (timecard_id, event_type, value_before, value_after, actor_id, notes)
    values (v_id, 'clock_in', null, v_after, v_actor, 'Timecard created');
  else
    v_before := jsonb_build_object(
      'clock_in', v_old.clock_in, 'clock_out', v_old.clock_out,
      'break_minutes', v_old.break_minutes, 'training_hours', v_old.training_hours,
      'notes', v_old.notes);

    update timecards set
      clock_in       = v_ci,
      clock_out      = v_co,
      break_minutes  = coalesce(p_break_minutes, break_minutes),
      training_hours = coalesce(p_training_hours, training_hours),
      notes          = p_notes,
      updated_at     = now()
    where id = p_timecard_id
    returning id into v_id;

    v_after := jsonb_build_object(
      'clock_in', v_ci, 'clock_out', v_co,
      'break_minutes', coalesce(p_break_minutes, v_old.break_minutes),
      'training_hours', coalesce(p_training_hours, v_old.training_hours),
      'notes', p_notes);

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


-- -------------------------------------------------------------------------
-- tc_approve: the critical workflow. Computes & stores regular/ot/training,
-- discrepancy_flag, lateness_tier; writes a status_change event; inserts a
-- lateness_history row iff tier >= 1. All in one transaction.
-- -------------------------------------------------------------------------
create or replace function tc_approve(
  p_timecard_id    uuid,
  p_training_hours numeric default null   -- optional manual override at approval
) returns jsonb
language plpgsql security definer as $$
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
  select id into v_actor from employees where title = 'Restaurant Manager' order by created_at limit 1;
  if v_actor is null then raise exception 'No Restaurant Manager (actor) found'; end if;

  select * into v_tc from timecards where id = p_timecard_id;
  if not found then raise exception 'Timecard % not found', p_timecard_id; end if;
  if v_tc.status not in ('pending','reviewed') then
    raise exception 'Cannot approve a % timecard', v_tc.status;
  end if;
  if v_tc.clock_in is null or v_tc.clock_out is null then
    raise exception 'Clock in and clock out are required to approve';
  end if;

  -- thresholds come from setup, never hardcoded
  select lateness_tier1_minutes, lateness_tier2_minutes, discrepancy_threshold_hours
    into v_t1, v_t2, v_dth
    from setup order by updated_at desc nulls last limit 1;
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


-- -------------------------------------------------------------------------
-- tc_override: change one field with a required note + full audit.
-- -------------------------------------------------------------------------
create or replace function tc_override(
  p_timecard_id uuid,
  p_field       text,
  p_value       text,
  p_note        text
) returns jsonb
language plpgsql security definer as $$
declare
  v_actor uuid;
  v_tc    timecards%rowtype;
  v_after jsonb;
  v_old   jsonb;
  v_new   jsonb;
begin
  if p_note is null or btrim(p_note) = '' then
    raise exception 'A note is required for an override';
  end if;
  select id into v_actor from employees where title = 'Restaurant Manager' order by created_at limit 1;
  if v_actor is null then raise exception 'No Restaurant Manager (actor) found'; end if;

  select * into v_tc from timecards where id = p_timecard_id;
  if not found then raise exception 'Timecard % not found', p_timecard_id; end if;

  if p_field = 'clock_in' then
    v_old := to_jsonb(v_tc.clock_in);
    update timecards set clock_in = case when p_value is null or p_value='' then null
                                         else (v_tc.date::text||' '||p_value)::timestamptz end,
      override_by = v_actor, override_at = now(), updated_at = now() where id = p_timecard_id;
  elsif p_field = 'clock_out' then
    v_old := to_jsonb(v_tc.clock_out);
    update timecards set clock_out = case when p_value is null or p_value='' then null
                                          else (v_tc.date::text||' '||p_value)::timestamptz end,
      override_by = v_actor, override_at = now(), updated_at = now() where id = p_timecard_id;
  elsif p_field = 'break_minutes' then
    v_old := to_jsonb(v_tc.break_minutes);
    update timecards set break_minutes = p_value::int,
      override_by = v_actor, override_at = now(), updated_at = now() where id = p_timecard_id;
  elsif p_field = 'training_hours' then
    v_old := to_jsonb(v_tc.training_hours);
    update timecards set training_hours = p_value::numeric,
      override_by = v_actor, override_at = now(), updated_at = now() where id = p_timecard_id;
  elsif p_field = 'regular_hours' then
    v_old := to_jsonb(v_tc.regular_hours);
    update timecards set regular_hours = p_value::numeric,
      override_by = v_actor, override_at = now(), updated_at = now() where id = p_timecard_id;
  elsif p_field = 'ot_hours' then
    v_old := to_jsonb(v_tc.ot_hours);
    update timecards set ot_hours = p_value::numeric,
      override_by = v_actor, override_at = now(), updated_at = now() where id = p_timecard_id;
  elsif p_field = 'lateness_tier' then
    v_old := to_jsonb(v_tc.lateness_tier);
    update timecards set lateness_tier = p_value::int,
      override_by = v_actor, override_at = now(), updated_at = now() where id = p_timecard_id;
  elsif p_field = 'notes' then
    v_old := to_jsonb(v_tc.notes);
    update timecards set notes = p_value,
      override_by = v_actor, override_at = now(), updated_at = now() where id = p_timecard_id;
  else
    raise exception 'Field % cannot be overridden', p_field;
  end if;

  select to_jsonb(t) into v_after from timecards t where id = p_timecard_id;
  v_new := v_after -> p_field;

  insert into timecard_events (timecard_id, event_type, value_before, value_after, actor_id, notes)
  values (p_timecard_id, 'override',
          jsonb_build_object('field', p_field, 'value', v_old),
          jsonb_build_object('field', p_field, 'value', v_new),
          v_actor, p_note);

  return v_after;
end;
$$;


-- -------------------------------------------------------------------------
-- tc_create_adhoc: timecard with no shift (shift_id null).
-- -------------------------------------------------------------------------
create or replace function tc_create_adhoc(
  p_employee_id   uuid,
  p_date          date,
  p_clock_in      text default null,
  p_clock_out     text default null,
  p_break_minutes int  default 0,
  p_notes         text default null
) returns jsonb
language plpgsql security definer as $$
declare
  v_actor uuid; v_id uuid; v_ci timestamptz; v_co timestamptz; v_after jsonb;
begin
  select id into v_actor from employees where title = 'Restaurant Manager' order by created_at limit 1;
  if v_actor is null then raise exception 'No Restaurant Manager (actor) found'; end if;
  if p_employee_id is null or p_date is null then raise exception 'Employee and date are required'; end if;

  v_ci := case when p_clock_in  is not null and p_clock_in  <> '' then (p_date::text||' '||p_clock_in )::timestamptz end;
  v_co := case when p_clock_out is not null and p_clock_out <> '' then (p_date::text||' '||p_clock_out)::timestamptz end;
  if v_ci is not null and v_co is not null and v_co < v_ci then v_co := v_co + interval '1 day'; end if;

  insert into timecards (employee_id, shift_id, date, clock_in, clock_out, break_minutes, notes, status, updated_at)
  values (p_employee_id, null, p_date, v_ci, v_co, coalesce(p_break_minutes,0), p_notes, 'pending', now())
  returning id into v_id;

  select to_jsonb(t) into v_after from timecards t where id = v_id;
  insert into timecard_events (timecard_id, event_type, value_before, value_after, actor_id, notes)
  values (v_id, 'clock_in', null, v_after, v_actor, 'Ad-hoc timecard created');
  return v_after;
end;
$$;


-- -------------------------------------------------------------------------
-- tc_set_status: forward-only transitions that don't compute fields.
-- pending -> reviewed, approved -> posted. (approved goes through tc_approve.)
-- -------------------------------------------------------------------------
create or replace function tc_set_status(p_timecard_id uuid, p_to text)
returns jsonb
language plpgsql security definer as $$
declare
  v_actor uuid; v_tc timecards%rowtype; v_before jsonb; v_after jsonb;
begin
  select id into v_actor from employees where title = 'Restaurant Manager' order by created_at limit 1;
  if v_actor is null then raise exception 'No Restaurant Manager (actor) found'; end if;

  select * into v_tc from timecards where id = p_timecard_id;
  if not found then raise exception 'Timecard % not found', p_timecard_id; end if;

  if p_to = 'approved' then
    raise exception 'Use tc_approve to approve (it computes hours/flags)';
  elsif not ((v_tc.status = 'pending'  and p_to = 'reviewed')
          or (v_tc.status = 'approved' and p_to = 'posted')) then
    raise exception 'Invalid transition % -> %', v_tc.status, p_to;
  end if;

  v_before := to_jsonb(v_tc);
  update timecards set status = p_to, updated_at = now() where id = p_timecard_id;
  select to_jsonb(t) into v_after from timecards t where id = p_timecard_id;

  insert into timecard_events (timecard_id, event_type, value_before, value_after, actor_id, notes)
  values (p_timecard_id, 'status_change', v_before, v_after, v_actor,
          format('%s -> %s', v_tc.status, p_to));
  return v_after;
end;
$$;


-- -------------------------------------------------------------------------
-- tc_add_note: append an audit note (does not change timecard fields).
-- -------------------------------------------------------------------------
create or replace function tc_add_note(p_timecard_id uuid, p_note text)
returns jsonb
language plpgsql security definer as $$
declare v_actor uuid;
begin
  if p_note is null or btrim(p_note) = '' then raise exception 'Note text is required'; end if;
  select id into v_actor from employees where title = 'Restaurant Manager' order by created_at limit 1;
  if v_actor is null then raise exception 'No Restaurant Manager (actor) found'; end if;
  if not exists (select 1 from timecards where id = p_timecard_id) then
    raise exception 'Timecard % not found', p_timecard_id;
  end if;

  insert into timecard_events (timecard_id, event_type, value_before, value_after, actor_id, notes)
  values (p_timecard_id, 'note', null, jsonb_build_object('note', p_note), v_actor, p_note);
  return jsonb_build_object('ok', true);
end;
$$;


-- -------------------------------------------------------------------------
-- tc_lateness_range: read-time lateness for the scheduling grid flags.
-- minutes_late computed from shift.start_time vs timecards.clock_in (not stored).
-- -------------------------------------------------------------------------
create or replace function tc_lateness_range(p_start date, p_end date)
returns table(shift_id uuid, timecard_id uuid, employee_id uuid, work_date date,
              lateness_tier int, minutes_late int)
language sql stable as $$
  select t.shift_id, t.id, t.employee_id, t.date, t.lateness_tier,
         greatest(0, floor(extract(epoch from
           (t.clock_in - (t.date::text||' '||s.start_time::text)::timestamptz))/60.0))::int
  from timecards t
  join shifts s on s.id = t.shift_id
  where t.status in ('approved','posted')
    and t.lateness_tier >= 1
    and t.date between p_start and p_end
    and t.clock_in is not null
    and s.start_time is not null;
$$;

-- Expose the new functions to PostgREST immediately (avoids a stale-cache 404).
notify pgrst, 'reload schema';

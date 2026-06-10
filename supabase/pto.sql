-- =========================================================================
-- Manadele — PTO Calculation Engine (Tier 1, item #4 — last math item)
-- Run this in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- The WRITE side that feeds pto_allocations.paid_hours (the pay engine already
-- reads it). On approval the allocator front-loads paid hours (8/day max),
-- splits per pay period, decrements the balance via an append-only ledger.
-- No schema changes — Migration 001 created all four PTO tables.
--
-- Pay-period boundaries are NOT computed here: the API route computes them
-- with lib/payroll.ts (periodsForRange) and passes them in as p_periods, so
-- the period math has a single source of truth shared with the pay engine.
--
-- Conventions: thresholds/actor read from data; multi-table writes wrapped in
-- one transaction (function body); no auth/RLS; negative balance allowed.
-- =========================================================================

-- -------------------------------------------------------------------------
-- pto_approve: the allocator. Transactional. status pending -> approved.
--   p_periods: jsonb map { "YYYY-MM-DD": {"start":"...","end":"..."}, ... }
--   covering every date in [start_date, end_date] (built via lib/payroll.ts).
-- -------------------------------------------------------------------------
create or replace function pto_approve(p_request_id uuid, p_periods jsonb)
returns jsonb
language plpgsql security definer as $$
declare
  v_actor   uuid;
  v_req     pto_requests%rowtype;
  v_days    int;
  v_cap     numeric;
  v_remaining numeric;
  v_total_paid numeric := 0;
  v_date    date;
  v_paid    numeric;
  v_unpaid  numeric;
  v_period  jsonb;
  v_bal     numeric;
begin
  select id into v_actor from employees where title = 'Restaurant Manager' order by created_at limit 1;
  if v_actor is null then raise exception 'No Restaurant Manager (actor) found'; end if;

  select * into v_req from pto_requests where id = p_request_id;
  if not found then raise exception 'PTO request % not found', p_request_id; end if;
  if v_req.status <> 'pending' then
    raise exception 'PTO request is % (only pending requests can be approved)', v_req.status;
  end if;

  -- Capacity check — never silently cap.
  v_days := (v_req.end_date - v_req.start_date) + 1;
  v_cap  := v_days * 8;
  if v_req.total_hours_requested > v_cap then
    raise exception 'Requested hours exceed range capacity (% h requested, % h max over % day(s))',
      v_req.total_hours_requested, v_cap, v_days;
  end if;

  -- Overlap check — no two approved requests on the same dates for one employee.
  if exists (
    select 1 from pto_requests r
    where r.employee_id = v_req.employee_id
      and r.id <> v_req.id
      and r.status = 'approved'
      and r.start_date <= v_req.end_date
      and r.end_date   >= v_req.start_date
  ) then
    raise exception 'Overlapping approved PTO exists for this employee';
  end if;

  -- Front-loaded per-day allocation.
  v_remaining := v_req.total_hours_requested;
  for v_date in select generate_series(v_req.start_date, v_req.end_date, interval '1 day')::date loop
    v_paid   := least(8, v_remaining);
    if v_paid < 0 then v_paid := 0; end if;
    v_remaining := v_remaining - v_paid;
    v_unpaid := 8 - v_paid;

    v_period := p_periods -> v_date::text;
    if v_period is null then
      raise exception 'Missing pay period mapping for %', v_date;
    end if;

    insert into pto_allocations
      (pto_request_id, employee_id, date, paid_hours, unpaid_hours, pay_period_start, pay_period_end)
    values
      (p_request_id, v_req.employee_id, v_date, round(v_paid,2), round(v_unpaid,2),
       (v_period->>'start')::date, (v_period->>'end')::date);

    v_total_paid := v_total_paid + v_paid;
  end loop;

  -- Balance decrement (ledger + current state). Negative is allowed.
  insert into pto_balance_transactions (employee_id, delta_hours, transaction_type, reference_id, notes)
  values (v_req.employee_id, -round(v_total_paid,2), 'use', p_request_id, 'PTO request approved');

  insert into pto_balances (employee_id, balance_hours, updated_at)
  values (v_req.employee_id, -round(v_total_paid,2), now())
  on conflict (employee_id) do update
    set balance_hours = pto_balances.balance_hours - round(v_total_paid,2), updated_at = now();

  update pto_requests
     set status = 'approved', decided_at = now(), decided_by = v_actor
   where id = p_request_id;

  select balance_hours into v_bal from pto_balances where employee_id = v_req.employee_id;

  return jsonb_build_object(
    'request_id', p_request_id,
    'days', v_days,
    'total_paid', round(v_total_paid,2),
    'balance_hours', v_bal,
    'negative_balance', (v_bal < 0),
    'allocations', (
      select jsonb_agg(jsonb_build_object(
        'date', date, 'paid_hours', paid_hours, 'unpaid_hours', unpaid_hours,
        'pay_period_start', pay_period_start, 'pay_period_end', pay_period_end) order by date)
      from pto_allocations where pto_request_id = p_request_id)
  );
end;$$;


-- -------------------------------------------------------------------------
-- pto_deny: pending -> denied. Appends a note. Transactional.
-- -------------------------------------------------------------------------
create or replace function pto_deny(p_request_id uuid, p_notes text default null)
returns jsonb
language plpgsql security definer as $$
declare v_actor uuid; v_req pto_requests%rowtype;
begin
  select id into v_actor from employees where title = 'Restaurant Manager' order by created_at limit 1;
  if v_actor is null then raise exception 'No Restaurant Manager (actor) found'; end if;
  select * into v_req from pto_requests where id = p_request_id;
  if not found then raise exception 'PTO request % not found', p_request_id; end if;
  if v_req.status <> 'pending' then raise exception 'PTO request is % (only pending can be denied)', v_req.status; end if;

  update pto_requests
     set status = 'denied', decided_at = now(), decided_by = v_actor,
         notes = case when p_notes is null or btrim(p_notes) = '' then notes
                      else coalesce(notes || ' | ', '') || p_notes end
   where id = p_request_id;
  return jsonb_build_object('request_id', p_request_id, 'status', 'denied');
end;$$;


-- -------------------------------------------------------------------------
-- pto_unapprove: approved -> pending. Reverses allocations + balance.
-- Refuses if payroll has been posted for any pay period this PTO touches.
-- -------------------------------------------------------------------------
create or replace function pto_unapprove(p_request_id uuid)
returns jsonb
language plpgsql security definer as $$
declare v_req pto_requests%rowtype; v_total_paid numeric;
begin
  select * into v_req from pto_requests where id = p_request_id;
  if not found then raise exception 'PTO request % not found', p_request_id; end if;
  if v_req.status <> 'approved' then raise exception 'PTO request is % (only approved can be unapproved)', v_req.status; end if;

  -- Guard: don't reverse what's already been paid out.
  if exists (
    select 1
    from pto_allocations a
    join timecards t on t.status = 'posted' and t.date between a.pay_period_start and a.pay_period_end
    where a.pto_request_id = p_request_id
  ) then
    raise exception 'Cannot unapprove — payroll posted for this period';
  end if;

  select coalesce(sum(paid_hours), 0) into v_total_paid from pto_allocations where pto_request_id = p_request_id;

  delete from pto_allocations where pto_request_id = p_request_id;

  insert into pto_balance_transactions (employee_id, delta_hours, transaction_type, reference_id, notes)
  values (v_req.employee_id, round(v_total_paid,2), 'adjustment', p_request_id,
          format('Reversed from request %s', p_request_id));

  insert into pto_balances (employee_id, balance_hours, updated_at)
  values (v_req.employee_id, round(v_total_paid,2), now())
  on conflict (employee_id) do update
    set balance_hours = pto_balances.balance_hours + round(v_total_paid,2), updated_at = now();

  update pto_requests set status = 'pending', decided_at = null, decided_by = null where id = p_request_id;

  return jsonb_build_object('request_id', p_request_id, 'status', 'pending', 'restored', round(v_total_paid,2));
end;$$;


-- -------------------------------------------------------------------------
-- pto_adjust_balance: manual accrual/seed/correction. Transactional.
-- -------------------------------------------------------------------------
create or replace function pto_adjust_balance(p_employee_id uuid, p_delta numeric, p_notes text default null)
returns jsonb
language plpgsql security definer as $$
declare v_bal numeric;
begin
  if p_employee_id is null then raise exception 'employee_id required'; end if;
  if p_delta is null then raise exception 'delta required'; end if;

  insert into pto_balance_transactions (employee_id, delta_hours, transaction_type, notes)
  values (p_employee_id, round(p_delta,2), 'adjustment', p_notes);

  insert into pto_balances (employee_id, balance_hours, updated_at)
  values (p_employee_id, round(p_delta,2), now())
  on conflict (employee_id) do update
    set balance_hours = pto_balances.balance_hours + round(p_delta,2), updated_at = now();

  select balance_hours into v_bal from pto_balances where employee_id = p_employee_id;
  return jsonb_build_object('employee_id', p_employee_id, 'balance_hours', v_bal);
end;$$;


-- -------------------------------------------------------------------------
-- pto_summary: read-only. Current balance + recent ledger + pending count.
-- -------------------------------------------------------------------------
create or replace function pto_summary(p_employee_id uuid)
returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'employee_id', p_employee_id,
    'balance_hours', coalesce((select balance_hours from pto_balances where employee_id = p_employee_id), 0),
    'pending_requests', (select count(*) from pto_requests where employee_id = p_employee_id and status = 'pending'),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'delta_hours', delta_hours, 'transaction_type', transaction_type,
        'notes', notes, 'created_at', created_at) order by created_at desc)
      from (select * from pto_balance_transactions where employee_id = p_employee_id
            order by created_at desc limit 10) t), '[]'::jsonb)
  );
$$;

-- Expose the new functions to PostgREST immediately.
notify pgrst, 'reload schema';

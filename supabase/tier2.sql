-- =========================================================================
-- Manadele — Tier 2 Accountability Layer — swap RPCs only.
-- Run this in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Reports + PTO overlay are read-only (no RPCs). The only transactional writes
-- here are the three swap operations. No schema changes (swap_history exists
-- from Migration 001). No auth/RLS.
-- =========================================================================

-- swap_create: record a pending swap. original_employee_id is pulled from the
-- shift's current assignee at insert time; shifts.employee_id is NOT changed
-- until the swap is accepted.
create or replace function swap_create(
  p_shift_id uuid,
  p_new_employee_id uuid,
  p_notes text default null
) returns jsonb
language plpgsql security definer as $$
declare v_actor uuid; v_original uuid; v_id uuid;
begin
  select id into v_actor from employees where title = 'Restaurant Manager' order by created_at limit 1;
  select employee_id into v_original from shifts where id = p_shift_id;
  if v_original is null then raise exception 'Shift % not found (or has no assignee)', p_shift_id; end if;
  if p_new_employee_id is null then raise exception 'A new employee is required'; end if;

  insert into swap_history (shift_id, original_employee_id, new_employee_id, status, swapped_by, notes)
  values (p_shift_id, v_original, p_new_employee_id, 'pending', v_actor, p_notes)
  returning id into v_id;

  return (select to_jsonb(s) from swap_history s where id = v_id);
end;$$;


-- swap_accept: complete a pending swap and reassign the shift. Transactional —
-- the status flip and the shifts.employee_id update succeed or fail together.
create or replace function swap_accept(p_swap_id uuid)
returns jsonb
language plpgsql security definer as $$
declare v_swap swap_history%rowtype;
begin
  select * into v_swap from swap_history where id = p_swap_id;
  if not found then raise exception 'Swap % not found', p_swap_id; end if;
  if v_swap.status <> 'pending' then raise exception 'Swap is % (only pending swaps can be accepted)', v_swap.status; end if;

  update swap_history set status = 'completed' where id = p_swap_id;
  update shifts set employee_id = v_swap.new_employee_id where id = v_swap.shift_id;

  return (select to_jsonb(s) from swap_history s where id = p_swap_id);
end;$$;


-- swap_cancel: drop a pending swap (shifts.employee_id never changed).
create or replace function swap_cancel(p_swap_id uuid)
returns jsonb
language plpgsql security definer as $$
declare v_status text;
begin
  select status into v_status from swap_history where id = p_swap_id;
  if v_status is null then raise exception 'Swap % not found', p_swap_id; end if;
  if v_status <> 'pending' then raise exception 'Only a pending swap can be cancelled (is %)', v_status; end if;
  delete from swap_history where id = p_swap_id;
  return jsonb_build_object('cancelled', p_swap_id);
end;$$;

-- Expose the new functions to PostgREST immediately.
notify pgrst, 'reload schema';

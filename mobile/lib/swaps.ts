import { supabase } from "./supabase";

// Employee swap-request data layer, backed by migration 011:
//   swap_eligible_teammates — who could take a given shift (same position,
//     same outlet, free during the window) + their tradeable shifts;
//   swap_request_submit — targeted 1-to-1 request (optionally naming one of
//     their shifts to trade for), 24h cutoff enforced server-side;
//   swap_request_accept / decline — target's response;
//   swap_request_cancel — either party, before the manager decides;
//   my_swap_requests — both directions with shift details.
// Everything infers the employee from auth.uid() server-side; tenant scoping
// is RLS's job — no client-side tenant filters (same conventions as pto.ts).

export type SwapStatus =
  | "pending_target"
  | "pending_manager"
  | "approved"
  | "denied"
  | "declined"
  | "canceled"
  | "pending" // legacy Phase 1 manager-recorded values
  | "completed";

export type EligibleTeammate = {
  employee_id: string;
  employee_name: string;
  employee_position: string | null;
  /** Their upcoming tradeable shifts (next 14 days, ≥24h out). */
  shifts: {
    shift_id: string;
    shift_date: string;
    start_time: string | null;
    end_time: string | null;
    shift_position: string | null;
    outlet_name: string | null;
  }[];
};

export type MySwapRequest = {
  swap_id: string;
  direction: "outgoing" | "incoming";
  status: SwapStatus;
  counterparty_name: string;
  requested_shift_id: string | null;
  requested_shift_date: string | null;
  requested_start_time: string | null;
  requested_end_time: string | null;
  requested_position: string | null;
  requested_outlet_name: string | null;
  offered_shift_id: string | null;
  offered_shift_date: string | null;
  offered_start_time: string | null;
  offered_end_time: string | null;
  offered_position: string | null;
  offered_outlet_name: string | null;
  target_accepted_at: string | null;
  manager_decision_at: string | null;
  created_at: string;
};

function day(v: unknown): string | null {
  return v ? String(v).slice(0, 10) : null;
}

/**
 * Eligible swap partners for one of MY shifts, grouped client-side from the
 * RPC's one-row-per-(teammate, candidate-shift) shape.
 */
export async function getEligibleTeammates(
  shiftId: string
): Promise<EligibleTeammate[]> {
  const { data, error } = await supabase.rpc("swap_eligible_teammates", {
    p_shift_id: shiftId,
  });
  if (error) {
    throw new Error(error.message);
  }
  const byId = new Map<string, EligibleTeammate>();
  for (const r of data ?? []) {
    let t = byId.get(r.employee_id);
    if (!t) {
      t = {
        employee_id: r.employee_id,
        employee_name: r.employee_name,
        employee_position: r.employee_position ?? null,
        shifts: [],
      };
      byId.set(r.employee_id, t);
    }
    if (r.shift_id) {
      t.shifts.push({
        shift_id: r.shift_id,
        shift_date: day(r.shift_date)!,
        start_time: r.start_time ?? null,
        end_time: r.end_time ?? null,
        shift_position: r.shift_position ?? null,
        outlet_name: r.outlet_name ?? null,
      });
    }
  }
  return [...byId.values()];
}

/**
 * Request to swap MY shift with a teammate. targetShiftId names one of their
 * shifts to trade for; omit it for "any of their shifts" (manager assigns at
 * approval). Returns the swap id.
 */
export async function submitSwapRequest(
  myShiftId: string,
  targetEmployeeId: string,
  targetShiftId?: string
): Promise<string> {
  const { data, error } = await supabase.rpc("swap_request_submit", {
    p_my_shift_id: myShiftId,
    p_target_employee_id: targetEmployeeId,
    ...(targetShiftId ? { p_target_shift_id: targetShiftId } : {}),
  });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** Accept an incoming swap (target only) → waits on the manager. */
export async function acceptSwap(swapId: string): Promise<void> {
  const { error } = await supabase.rpc("swap_request_accept", {
    p_swap_id: swapId,
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** Decline an incoming swap (target only). */
export async function declineSwap(swapId: string): Promise<void> {
  const { error } = await supabase.rpc("swap_request_decline", {
    p_swap_id: swapId,
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** Cancel a pending swap (either party, before the manager decides). */
export async function cancelSwap(swapId: string): Promise<void> {
  const { error } = await supabase.rpc("swap_request_cancel", {
    p_swap_id: swapId,
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** My outgoing + incoming swaps (pending always; settled from last 30 days). */
export async function getMySwapRequests(): Promise<MySwapRequest[]> {
  const { data, error } = await supabase.rpc("my_swap_requests");
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => ({
    swap_id: r.swap_id,
    direction: r.direction as "outgoing" | "incoming",
    status: r.status as SwapStatus,
    counterparty_name: r.counterparty_name,
    requested_shift_id: r.requested_shift_id ?? null,
    requested_shift_date: day(r.requested_shift_date),
    requested_start_time: r.requested_start_time ?? null,
    requested_end_time: r.requested_end_time ?? null,
    requested_position: r.requested_position ?? null,
    requested_outlet_name: r.requested_outlet_name ?? null,
    offered_shift_id: r.offered_shift_id ?? null,
    offered_shift_date: day(r.offered_shift_date),
    offered_start_time: r.offered_start_time ?? null,
    offered_end_time: r.offered_end_time ?? null,
    offered_position: r.offered_position ?? null,
    offered_outlet_name: r.offered_outlet_name ?? null,
    target_accepted_at: r.target_accepted_at ?? null,
    manager_decision_at: r.manager_decision_at ?? null,
    created_at: r.created_at,
  }));
}

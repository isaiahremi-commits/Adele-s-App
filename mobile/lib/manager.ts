import { cycleLength, periodsForRange } from "../../shared/payroll";
import { getPaySettings } from "./pay";
import { supabase } from "./supabase";

// Manager-side data layer, backed by migration 012 plus the Phase 1 manager
// RPCs it wraps:
//   012 —    am_i_a_manager, manager_approval_inbox, coverage_approve/deny,
//            swap_request_approve/deny, large_party_add;
//   Phase 1 — pto_approve/pto_deny (p_periods built here from the shared
//            period math), ts_compute/ts_post (tip sheets), tc_approve
//            (timecards; refuses missing punches server-side).
// All the 012 RPCs verify is_restaurant_manager() server-side — the mobile
// tab gating is cosmetic, the database is the guard.

export type InboxPto = {
  id: string;
  employee_id: string;
  employee_name: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  total_hours_requested: number | null;
  requested_at: string | null;
};

export type InboxTipSheet = {
  id: string;
  date: string | null;
  status: "pending" | "ready";
  outlet_name: string | null;
  row_count: number;
  declared_total: number;
  large_party_total: number;
};

export type InboxCoverage = {
  id: string;
  callout_id: string;
  created_at: string | null;
  shift_date: string | null;
  start_time: string | null;
  end_time: string | null;
  position: string | null;
  outlet_name: string | null;
  caller_out_name: string;
  volunteer_name: string | null;
};

export type InboxSwap = {
  id: string;
  created_at: string | null;
  target_accepted_at: string | null;
  target_shift_id: string | null;
  needs_target_shift: boolean;
  original_employee_id: string;
  new_employee_id: string;
  initiator_name: string;
  target_name: string;
  requested_shift_date: string | null;
  requested_start_time: string | null;
  requested_end_time: string | null;
  requested_position: string | null;
  requested_outlet_name: string | null;
  offered_shift_date: string | null;
  offered_start_time: string | null;
  offered_end_time: string | null;
  offered_position: string | null;
};

export type InboxTimecard = {
  id: string;
  date: string;
  status: string;
  clock_in: string | null;
  clock_out: string | null;
  break_minutes: number;
  missing_punch: boolean;
  employee_name: string;
  shift_start_time: string | null;
  shift_end_time: string | null;
};

export type ManagerInbox = {
  counts: {
    ptos: number;
    tip_sheets: number;
    coverage: number;
    swaps: number;
    timecards: number;
  };
  total_pending: number;
  pending_ptos: InboxPto[];
  pending_tip_sheets: InboxTipSheet[];
  pending_coverage: InboxCoverage[];
  pending_swaps: InboxSwap[];
  pending_timecards: InboxTimecard[];
};

// ── manager status (cached per auth user) ─────────────────────────────────
let managerCache: { userId: string; value: boolean } | null = null;

/**
 * Whether the signed-in user is a Restaurant Manager. Cached per user id for
 * the session; a missing RPC (pre-012) reads as false, hiding the tab.
 */
export async function isManager(userId: string): Promise<boolean> {
  if (managerCache?.userId === userId) {
    return managerCache.value;
  }
  try {
    const { data, error } = await supabase.rpc("am_i_a_manager");
    if (error) {
      return false;
    }
    managerCache = { userId, value: data === true };
    return managerCache.value;
  } catch {
    return false;
  }
}

export function clearManagerCache(): void {
  managerCache = null;
}

// ── inbox ─────────────────────────────────────────────────────────────────
export async function getInbox(): Promise<ManagerInbox> {
  const { data, error } = await supabase.rpc("manager_approval_inbox");
  if (error) {
    throw new Error(error.message);
  }
  return data as unknown as ManagerInbox;
}

// ── coverage decisions (012) ──────────────────────────────────────────────
export async function approveCoverage(requestId: string): Promise<void> {
  const { error } = await supabase.rpc("coverage_approve", {
    p_coverage_request_id: requestId,
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** Rejects the VOLUNTEER; the request re-opens for other teammates. */
export async function denyCoverage(
  requestId: string,
  reason?: string
): Promise<void> {
  const { error } = await supabase.rpc("coverage_deny", {
    p_coverage_request_id: requestId,
    ...(reason ? { p_reason: reason } : {}),
  });
  if (error) {
    throw new Error(error.message);
  }
}

// ── swap decisions (012) ──────────────────────────────────────────────────
/** targetShiftId is required by the server when the request said "any shift". */
export async function approveSwap(
  swapId: string,
  targetShiftId?: string
): Promise<void> {
  const { error } = await supabase.rpc("swap_request_approve", {
    p_swap_id: swapId,
    ...(targetShiftId ? { p_target_shift_id_override: targetShiftId } : {}),
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function denySwap(swapId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc("swap_request_deny", {
    p_swap_id: swapId,
    ...(reason ? { p_reason: reason } : {}),
  });
  if (error) {
    throw new Error(error.message);
  }
}

// ── PTO decisions (Phase 1 RPCs) ──────────────────────────────────────────
/**
 * pto_approve requires a per-day pay-period map; build it exactly the way
 * the web /pto page does — shared/payroll.ts boundaries from the tenant's
 * configured cycle.
 */
export async function approvePto(request: {
  id: string;
  start_date: string;
  end_date: string;
}): Promise<void> {
  const settings = await getPaySettings();
  const cycle = cycleLength(settings.pay_cycle);
  const periods = periodsForRange(request.start_date, request.end_date, cycle);
  const { error } = await supabase.rpc("pto_approve", {
    p_request_id: request.id,
    p_periods: periods,
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function denyPto(requestId: string, notes?: string): Promise<void> {
  const { error } = await supabase.rpc("pto_deny", {
    p_request_id: requestId,
    ...(notes ? { p_notes: notes } : {}),
  });
  if (error) {
    throw new Error(error.message);
  }
}

// ── tip sheets (Phase 1 RPCs: pending → ready → posted) ───────────────────
/** ts_compute: runs the tip formula and marks the sheet 'ready'. */
export async function computeTipSheet(sheetId: string): Promise<void> {
  const { error } = await supabase.rpc("ts_compute", {
    p_tip_sheet_id: sheetId,
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** ts_post: locks a 'ready' sheet; the pay engine starts reading it. */
export async function postTipSheet(sheetId: string): Promise<void> {
  const { error } = await supabase.rpc("ts_post", { p_tip_sheet_id: sheetId });
  if (error) {
    throw new Error(error.message);
  }
}

// ── timecards (Phase 1 RPC) ───────────────────────────────────────────────
/** tc_approve — the server refuses timecards missing clock in/out. */
export async function approveTimecard(timecardId: string): Promise<void> {
  const { error } = await supabase.rpc("tc_approve", {
    p_timecard_id: timecardId,
  });
  if (error) {
    throw new Error(error.message);
  }
}

// ── large party (012) ─────────────────────────────────────────────────────
export async function addLargeParty(
  outletId: string,
  date: string,
  amount: number,
  notes?: string
): Promise<string> {
  const { data, error } = await supabase.rpc("large_party_add", {
    p_outlet_id: outletId,
    p_date: date,
    p_amount: amount,
    ...(notes && notes.trim() !== "" ? { p_notes: notes.trim() } : {}),
  });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

// ── manager-RLS direct reads used by the inbox UI ─────────────────────────
/** Outlets for the large-party picker (manager RLS grants the read). */
export async function getOutlets(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from("outlets")
    .select("id, name")
    .order("name");
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/**
 * A target employee's upcoming shifts — the picker for approving an
 * "any of their shifts" swap (manager RLS grants the read).
 */
export async function getUpcomingShifts(employeeId: string): Promise<
  {
    id: string;
    date: string | null;
    start_time: string | null;
    end_time: string | null;
    position: string | null;
  }[]
> {
  const { data, error } = await supabase
    .from("shifts")
    .select("id, date, start_time, end_time, position")
    .eq("employee_id", employeeId)
    .gte("date", new Date().toISOString().slice(0, 10))
    .order("date", { ascending: true })
    .limit(14);
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

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

// ── PR #18 Work-mode reads (all manager-RLS direct reads / writes) ────────

export type TeamShift = {
  shift_id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  position: string | null;
  start_time: string | null;
  end_time: string | null;
  outlet_name: string | null;
  called_out: boolean;
};

/** Everyone scheduled on a date, with called-out flags (Team tab). */
export async function getTeamForDate(date: string): Promise<TeamShift[]> {
  const [{ data, error }, calloutsRes] = await Promise.all([
    supabase
      .from("shifts")
      .select(
        "id, employee_id, start_time, end_time, position, outlets(name), employees!inner(first_name, last_name)"
      )
      .eq("date", date)
      .order("start_time"),
    supabase.from("callout_history").select("employee_id").eq("date", date),
  ]);
  if (error) {
    throw new Error(error.message);
  }
  const calledOut = new Set(
    (calloutsRes.data ?? []).map((c) => c.employee_id)
  );
  return (data ?? []).map((s) => ({
    shift_id: s.id,
    employee_id: s.employee_id ?? "",
    first_name: s.employees?.first_name ?? "?",
    last_name: s.employees?.last_name ?? "",
    position: s.position ?? null,
    start_time: s.start_time ?? null,
    end_time: s.end_time ?? null,
    outlet_name: s.outlets?.name ?? null,
    called_out: s.employee_id !== null && calledOut.has(s.employee_id),
  }));
}

export type RangeShift = {
  shift_id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  position: string | null;
  outlet_name: string | null;
};

/** All shifts in [start, end] with names — the Hours tab's raw material. */
export async function getShiftsRange(
  start: string,
  end: string
): Promise<RangeShift[]> {
  const { data, error } = await supabase
    .from("shifts")
    .select(
      "id, employee_id, date, start_time, end_time, position, outlets(name), employees!inner(first_name, last_name)"
    )
    .gte("date", start)
    .lte("date", end)
    .order("date")
    .order("start_time");
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((s) => ({
    shift_id: s.id,
    employee_id: s.employee_id ?? "",
    first_name: s.employees?.first_name ?? "?",
    last_name: s.employees?.last_name ?? "",
    date: s.date ?? null,
    start_time: s.start_time ?? null,
    end_time: s.end_time ?? null,
    position: s.position ?? null,
    outlet_name: s.outlets?.name ?? null,
  }));
}

/** Wall-clock shift length in hours; overnight wraps forward. */
export function shiftHours(
  start: string | null,
  end: string | null
): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((x) => !Number.isInteger(x))) return 0;
  let h = eh + em / 60 - (sh + sm / 60);
  if (h < 0) h += 24;
  return Math.round(h * 100) / 100;
}

export type DaySheet = {
  id: string;
  outlet_name: string | null;
  status: string | null;
  service_charge: number;
  non_cash_tips: number;
};

/** Tip sheets for a date (Sales stopgap + the EOD wizard's worklist). */
export async function getSheetsForDate(date: string): Promise<DaySheet[]> {
  const { data, error } = await supabase
    .from("tip_sheets")
    .select("id, status, service_charge, non_cash_tips, outlets(name)")
    .eq("date", date);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((s) => ({
    id: s.id,
    outlet_name: s.outlets?.name ?? null,
    status: s.status ?? null,
    service_charge: Number(s.service_charge ?? 0),
    non_cash_tips: Number(s.non_cash_tips ?? 0),
  }));
}

export type SheetRow = {
  row_id: string;
  sheet_id: string;
  employee_id: string;
  name: string;
  declared_sc: number;
  declared_nc: number;
  tip_amount: number | null;
};

export async function getSheetRows(sheetIds: string[]): Promise<SheetRow[]> {
  if (sheetIds.length === 0) return [];
  const { data, error } = await supabase
    .from("tip_sheet_rows")
    .select(
      "id, tip_sheet_id, employee_id, declared_service_charge, declared_non_cash, tip_amount, employees!inner(first_name, last_name)"
    )
    .in("tip_sheet_id", sheetIds);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => ({
    row_id: r.id,
    sheet_id: r.tip_sheet_id ?? "",
    employee_id: r.employee_id ?? "",
    name: `${r.employees?.first_name ?? "?"} ${r.employees?.last_name ?? ""}`.trim(),
    declared_sc: Number(r.declared_service_charge ?? 0),
    declared_nc: Number(r.declared_non_cash ?? 0),
    tip_amount: r.tip_amount === null ? null : Number(r.tip_amount),
  }));
}

/** EOD "Add adjustment": overwrite a row's declared amounts (manager RLS). */
export async function updateDeclared(
  rowId: string,
  sc: number,
  nc: number
): Promise<void> {
  const { error } = await supabase
    .from("tip_sheet_rows")
    .update({ declared_service_charge: sc, declared_non_cash: nc })
    .eq("id", rowId);
  if (error) {
    throw new Error(error.message);
  }
}

/** EOD "Add team member": a fresh row on a sheet (walk-in coverage). */
export async function addSheetRow(
  sheetId: string,
  employeeId: string
): Promise<void> {
  const { error } = await supabase
    .from("tip_sheet_rows")
    .insert({ tip_sheet_id: sheetId, employee_id: employeeId });
  if (error) {
    throw new Error(error.message);
  }
}

export type DayTimecard = {
  id: string;
  employee_id: string;
  name: string;
  clock_in: string | null;
  clock_out: string | null;
  regular_hours: number;
  ot_hours: number;
  status: string;
  missing_punch: boolean;
};

export async function getTimecardsForDate(
  date: string
): Promise<DayTimecard[]> {
  const { data, error } = await supabase
    .from("timecards")
    .select(
      // timecards → employees has two FKs (employee_id, override_by) — hint
      // the embed at the employee_id one.
      "id, employee_id, clock_in, clock_out, regular_hours, ot_hours, status, employees!timecards_employee_id_fkey!inner(first_name, last_name)"
    )
    .eq("date", date);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((t) => ({
    id: t.id,
    employee_id: t.employee_id,
    name: `${t.employees?.first_name ?? "?"} ${t.employees?.last_name ?? ""}`.trim(),
    clock_in: t.clock_in,
    clock_out: t.clock_out,
    regular_hours: Number(t.regular_hours ?? 0),
    ot_hours: Number(t.ot_hours ?? 0),
    status: t.status,
    missing_punch: !t.clock_in || !t.clock_out,
  }));
}

export async function getPartiesForSheets(
  sheetIds: string[]
): Promise<{ id: string; revenue: number; notes: string | null }[]> {
  if (sheetIds.length === 0) return [];
  const { data, error } = await supabase
    .from("large_party_revenues")
    .select("id, revenue, notes")
    .in("tip_sheet_id", sheetIds);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((p) => ({
    id: p.id,
    revenue: Number(p.revenue ?? 0),
    notes: p.notes ?? null,
  }));
}

/** Active employees (for the EOD add-member picker). */
export async function getActiveEmployees(): Promise<
  { id: string; name: string }[]
> {
  const { data, error } = await supabase
    .from("employees")
    .select("id, first_name, last_name, termination_date")
    .is("termination_date", null)
    .order("first_name");
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((e) => ({
    id: e.id,
    name: `${e.first_name} ${e.last_name}`.trim(),
  }));
}

/** The day's submitted EOD report, if any (eod_reports, migration 019). */
export async function getEodReport(
  date: string
): Promise<{ id: string; notes: string | null } | null> {
  const { data, error } = await supabase
    .from("eod_reports")
    .select("id, notes")
    .eq("report_date", date)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** Locks the day: one eod_reports row per tenant+date (unique server-side). */
export async function submitEodReport(
  date: string,
  notes: string,
  submittedBy: string | null
): Promise<void> {
  const { error } = await supabase.from("eod_reports").insert({
    report_date: date,
    notes: notes.trim() || null,
    submitted_by: submittedBy,
  });
  if (error) {
    throw new Error(error.message);
  }
}

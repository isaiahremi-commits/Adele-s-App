import { supabase } from "./supabase";

// Missed-punch data layer (migrations 021 + 022):
//   021 — missed_punch_alerts, written by the pg_cron scan 25 minutes after
//         an unclocked scheduled start (own-rows + manager RLS reads here);
//   022 — missed_punch_requests, the employee-initiated repair flow
//         (submit/cancel RPCs) with manager decisions (approve/deny RPCs).
// Everything degrades gracefully pre-migration: reads catch to empty in the
// screens, mutations surface their errors.

export type MissedPunchAlert = {
  id: string;
  shift_id: string;
  employee_id: string;
  alerted_at: string;
};

export type MissedPunchRequest = {
  id: string;
  shift_id: string;
  employee_id: string;
  requested_clock_in: string;
  requested_clock_out: string;
  reason: string | null;
  status: string;
  created_at: string;
};

export type PendingMissedPunchRequest = MissedPunchRequest & {
  employee_name: string;
  shift_date: string | null;
  shift_start: string | null;
  shift_end: string | null;
  position: string | null;
};

/** My unresolved alerts (usually today's silent no-show flag). */
export async function getMyAlerts(): Promise<MissedPunchAlert[]> {
  const { data, error } = await supabase
    .from("missed_punch_alerts")
    .select("id, shift_id, employee_id, alerted_at")
    .is("resolved_at", null);
  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}

/** Manager: count of unresolved alerts (the "N unclocked shifts" pill). */
export async function getUnresolvedAlerts(): Promise<
  { id: string; shift_id: string; employee_name: string; alerted_at: string }[]
> {
  const { data, error } = await supabase
    .from("missed_punch_alerts")
    .select("id, shift_id, alerted_at, employees!inner(first_name, last_name)")
    .is("resolved_at", null)
    .order("alerted_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((a) => ({
    id: a.id,
    shift_id: a.shift_id,
    employee_name:
      `${a.employees?.first_name ?? "?"} ${a.employees?.last_name ?? ""}`.trim(),
    alerted_at: a.alerted_at,
  }));
}

/** My own requests (all statuses — pending drives the Schedule badge). */
export async function getMyMissedPunchRequests(): Promise<MissedPunchRequest[]> {
  const { data, error } = await supabase
    .from("missed_punch_requests")
    .select(
      "id, shift_id, employee_id, requested_clock_in, requested_clock_out, reason, status, created_at"
    )
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}

/** Manager: pending requests with names + shift context (RLS direct read). */
export async function getPendingMissedPunchRequests(): Promise<
  PendingMissedPunchRequest[]
> {
  const { data, error } = await supabase
    .from("missed_punch_requests")
    .select(
      "id, shift_id, employee_id, requested_clock_in, requested_clock_out, reason, status, created_at, employees!missed_punch_requests_employee_id_fkey!inner(first_name, last_name), shifts!inner(date, start_time, end_time, position)"
    )
    .eq("status", "pending")
    .order("created_at");
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    shift_id: r.shift_id,
    employee_id: r.employee_id,
    requested_clock_in: r.requested_clock_in,
    requested_clock_out: r.requested_clock_out,
    reason: r.reason,
    status: r.status,
    created_at: r.created_at,
    employee_name:
      `${r.employees?.first_name ?? "?"} ${r.employees?.last_name ?? ""}`.trim(),
    shift_date: r.shifts?.date ?? null,
    shift_start: r.shifts?.start_time ?? null,
    shift_end: r.shifts?.end_time ?? null,
    position: r.shifts?.position ?? null,
  }));
}

export async function submitMissedPunchRequest(
  shiftId: string,
  clockInIso: string,
  clockOutIso: string,
  reason: string
): Promise<string> {
  const { data, error } = await supabase.rpc("missed_punch_request_submit", {
    p_shift_id: shiftId,
    p_clock_in: clockInIso,
    p_clock_out: clockOutIso,
    ...(reason.trim() ? { p_reason: reason.trim() } : {}),
  });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function cancelMissedPunchRequest(id: string): Promise<void> {
  const { error } = await supabase.rpc("missed_punch_request_cancel", {
    p_request_id: id,
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function approveMissedPunchRequest(id: string): Promise<void> {
  const { error } = await supabase.rpc("missed_punch_request_approve", {
    p_request_id: id,
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function denyMissedPunchRequest(
  id: string,
  reason?: string
): Promise<void> {
  const { error } = await supabase.rpc("missed_punch_request_deny", {
    p_request_id: id,
    ...(reason?.trim() ? { p_reason: reason.trim() } : {}),
  });
  if (error) {
    throw new Error(error.message);
  }
}

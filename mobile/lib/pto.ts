import { supabase } from "./supabase";

// Employee PTO data layer, backed by migration 007:
//   reads — own-row SELECT policies on pto_balances / pto_requests;
//   writes — pto_submit / pto_modify / pto_cancel RPCs, which infer the
//   employee from auth.uid() server-side (no ids passed from the client).
// Tenant scoping is RLS's job — no client-side tenant filters.

export const PTO_REASONS = [
  "Sick",
  "Jury Duty",
  "Vacation",
  "Birthday",
  "Personal",
] as const;
export type PtoReason = (typeof PTO_REASONS)[number];

export type PtoStatus = "pending" | "approved" | "denied";

export type PtoRequest = {
  id: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
  total_hours_requested: number;
  notes: string | null;
  requested_at: string;
  decided_at: string | null;
};

/** Balance in hours for the signed-in employee; 0 if no balance row yet. */
export async function getMyBalance(): Promise<number> {
  // NOT .maybeSingle(): an employee's own-row RLS returns 0-or-1 rows, but a
  // MANAGER's RLS returns every employee's balance — the object-shaped
  // request then 400s ("multiple rows returned") on each PTO-tab load
  // (PR #15 Bug B). Fetch the visible rows and resolve the caller's own.
  const { data, error } = await supabase
    .from("pto_balances")
    .select("balance_hours, employee_id");
  if (error) {
    throw new Error(error.message);
  }
  if (!data || data.length === 0) return 0;
  if (data.length === 1) return Number(data[0].balance_hours ?? 0);
  // Multiple rows = manager view; pick the row linked to this login.
  // getSession() (local, instant) — NOT getUser(), which is a network
  // round-trip to the auth server and was the longest pole in the manager
  // Home hang (PR #19 bug 1): fetch has no timeout on RN/web, so one
  // stalled auth call wedged the whole screen.
  const uid = (await supabase.auth.getSession()).data.session?.user.id;
  if (!uid) return 0;
  const { data: emp } = await supabase
    .from("employees")
    .select("id")
    .eq("auth_user_id", uid)
    .limit(1)
    .maybeSingle();
  const own = emp ? data.find((r) => r.employee_id === emp.id) : null;
  return Number(own?.balance_hours ?? 0);
}

/** Own requests, optionally filtered by status, newest first. */
export async function getMyRequests(status?: PtoStatus): Promise<PtoRequest[]> {
  let query = supabase
    .from("pto_requests")
    .select(
      "id, start_date, end_date, reason, status, total_hours_requested, notes, requested_at, decided_at"
    )
    .order("start_date", { ascending: false });
  if (status) {
    query = query.eq("status", status);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** Create a pending request. Dates are "yyyy-MM-dd". Returns the new id. */
export async function submitRequest(
  startDate: string,
  endDate: string,
  reason: PtoReason
): Promise<string> {
  const { data, error } = await supabase.rpc("pto_submit", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_reason: reason,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** Edit an own, still-pending request. */
export async function modifyRequest(
  id: string,
  startDate: string,
  endDate: string,
  reason: PtoReason
): Promise<void> {
  const { error } = await supabase.rpc("pto_modify", {
    p_request_id: id,
    p_start_date: startDate,
    p_end_date: endDate,
    p_reason: reason,
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** Cancel an own request: pending → deleted, approved → reversed + marked. */
export async function cancelRequest(id: string): Promise<void> {
  const { error } = await supabase.rpc("pto_cancel", { p_request_id: id });
  if (error) {
    throw new Error(error.message);
  }
}

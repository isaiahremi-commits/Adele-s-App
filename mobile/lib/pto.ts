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
  // Own-row RLS means at most one row comes back — no employee_id filter
  // needed (and none available client-side without an extra query).
  const { data, error } = await supabase
    .from("pto_balances")
    .select("balance_hours")
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data?.balance_hours ?? 0;
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

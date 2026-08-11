import { supabase } from "./supabase";

// Employee callout + coverage data layer, backed by migration 010:
//   callout_submit — call out of an own upcoming shift (creates the callout
//     record AND an open coverage_request broadcast);
//   coverage_available_for_me — open requests the caller is eligible to
//     cover (same department, member of the shift's outlet, no conflict);
//   coverage_offer / coverage_withdraw — volunteer + change of heart;
//   my_callouts_and_coverage — own callouts and offers with statuses.
// Everything infers the employee from auth.uid() server-side; tenant scoping
// is RLS's job — no client-side tenant filters (same conventions as pto.ts).

export const CALLOUT_REASONS = [
  "Sick",
  "Emergency",
  "Personal",
  "Other",
] as const;
export type CalloutReason = (typeof CALLOUT_REASONS)[number];

export const CALLOUT_NOTES_MAX = 200;

export type CoverageOpportunity = {
  request_id: string;
  shift_id: string;
  shift_date: string;
  start_time: string | null;
  end_time: string | null;
  shift_position: string | null;
  outlet_id: string | null;
  outlet_name: string | null;
  requested_by: string;
};

export type MyCalloutOrOffer = {
  kind: "callout" | "coverage_offer";
  callout_id: string;
  request_id: string | null;
  shift_id: string | null;
  shift_date: string | null;
  start_time: string | null;
  end_time: string | null;
  shift_position: string | null;
  outlet_name: string | null;
  reason: string | null;
  notes: string | null;
  callout_status: string | null;
  coverage_status: string | null;
  volunteer_name: string | null;
  requested_by: string | null;
  created_at: string;
};

/** Call out of an own, today-or-future shift. Returns the callout id. */
export async function submitCallout(
  shiftId: string,
  reason: CalloutReason,
  notes?: string
): Promise<string> {
  const { data, error } = await supabase.rpc("callout_submit", {
    p_shift_id: shiftId,
    p_reason: reason,
    ...(notes && notes.trim() !== "" ? { p_notes: notes.trim() } : {}),
  });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** Open coverage requests the signed-in employee is eligible to cover. */
/**
 * "Running late" signal (PR #18, migration 019). Recording only — until
 * push lands (PR #19), Adèle sees these in the DB / hears via broadcast.
 */
export async function submitRunningLate(
  minutes: number,
  shiftId?: string
): Promise<void> {
  const { error } = await supabase.rpc("running_late_submit", {
    p_minutes: minutes,
    ...(shiftId ? { p_shift_id: shiftId } : {}),
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function getCoverageAvailable(): Promise<CoverageOpportunity[]> {
  const { data, error } = await supabase.rpc("coverage_available_for_me");
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => ({
    request_id: r.request_id,
    shift_id: r.shift_id,
    shift_date: String(r.shift_date).slice(0, 10),
    start_time: r.start_time ?? null,
    end_time: r.end_time ?? null,
    shift_position: r.shift_position ?? null,
    outlet_id: r.outlet_id ?? null,
    outlet_name: r.outlet_name ?? null,
    requested_by: r.requested_by,
  }));
}

/** Volunteer to cover an open request. */
export async function offerCoverage(requestId: string): Promise<void> {
  const { error } = await supabase.rpc("coverage_offer", {
    p_coverage_request_id: requestId,
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** Withdraw an own, still-pending coverage offer. */
export async function withdrawCoverage(requestId: string): Promise<void> {
  const { error } = await supabase.rpc("coverage_withdraw", {
    p_coverage_request_id: requestId,
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** Own callouts + coverage offers, newest first (server caps at 50). */
export async function getMyCalloutsAndCoverage(): Promise<MyCalloutOrOffer[]> {
  const { data, error } = await supabase.rpc("my_callouts_and_coverage");
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => ({
    kind: r.kind as "callout" | "coverage_offer",
    callout_id: r.callout_id,
    request_id: r.request_id ?? null,
    shift_id: r.shift_id ?? null,
    shift_date: r.shift_date ? String(r.shift_date).slice(0, 10) : null,
    start_time: r.start_time ?? null,
    end_time: r.end_time ?? null,
    shift_position: r.shift_position ?? null,
    outlet_name: r.outlet_name ?? null,
    reason: r.reason ?? null,
    notes: r.notes ?? null,
    callout_status: r.callout_status ?? null,
    coverage_status: r.coverage_status ?? null,
    volunteer_name: r.volunteer_name || null,
    requested_by: r.requested_by || null,
    created_at: r.created_at,
  }));
}

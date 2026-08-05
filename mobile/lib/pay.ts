import { supabase } from "./supabase";

// Employee pay + standing data layer, backed by migration 008:
//   reads — own-row SELECT policies on timecards / lateness_history /
//   callout_history;
//   RPCs — pay_breakdown_for_me (the caller's own pay_breakdown row) and
//   employee_pay_settings (the four setup values the Pay tab needs, since
//   setup itself stays manager-only).
// Everything infers the employee from auth.uid() server-side; tenant scoping
// is RLS's job — no client-side tenant filters (same conventions as pto.ts).

export type PaySettings = {
  pay_cycle: string;
  period_start_day: string;
  callout_threshold_count: number;
  callout_threshold_window_days: number;
};

export type PayBreakdown = {
  regular_hours: number;
  ot_hours: number;
  training_hours: number;
  pto_hours: number;
  projected_hours: number;
  regular_pay: number | null;
  ot_pay: number | null;
  training_pay: number | null;
  pto_pay: number | null;
  manager_amount: number;
  tip_rows_amount: number;
  sc_tips: number;
  nc_tips: number;
  tip_pay: number;
  gross_pay: number | null;
  has_missing_rate: boolean;
  warnings: string[];
  pay_type: string | null;
};

export type Timecard = {
  id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  break_minutes: number;
  regular_hours: number | null;
  ot_hours: number | null;
  training_hours: number | null;
  status: string;
};

export type LatenessSummary = { count: number; tier2Count: number };
export type CalloutSummary = { count: number; dates: string[] };

/** numeric columns can arrive as string over PostgREST — normalize, keep null. */
function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** Pay-cycle + callout-threshold config for the caller's tenant. */
export async function getPaySettings(): Promise<PaySettings> {
  const { data, error } = await supabase.rpc("employee_pay_settings");
  if (error) {
    throw new Error(error.message);
  }
  const row = data?.[0];
  if (!row) {
    throw new Error("Pay settings unavailable");
  }
  return row;
}

/**
 * The signed-in employee's own pay_breakdown row for [startDate, endDate]
 * ("yyyy-MM-dd"); null when there was no pay activity in the period.
 * mode 'prediction' adds scheduled-but-unworked hours, like the web toggle.
 */
export async function getMyPayBreakdown(
  startDate: string,
  endDate: string,
  mode: "actual" | "prediction" = "actual"
): Promise<PayBreakdown | null> {
  const { data, error } = await supabase.rpc("pay_breakdown_for_me", {
    p_start: startDate,
    p_end: endDate,
    p_mode: mode,
  });
  if (error) {
    throw new Error(error.message);
  }
  const row = data?.[0];
  if (!row) {
    return null;
  }
  return {
    regular_hours: num(row.regular_hours) ?? 0,
    ot_hours: num(row.ot_hours) ?? 0,
    training_hours: num(row.training_hours) ?? 0,
    pto_hours: num(row.pto_hours) ?? 0,
    projected_hours: num(row.projected_hours) ?? 0,
    regular_pay: num(row.regular_pay),
    ot_pay: num(row.ot_pay),
    training_pay: num(row.training_pay),
    pto_pay: num(row.pto_pay),
    manager_amount: num(row.manager_amount) ?? 0,
    tip_rows_amount: num(row.tip_rows_amount) ?? 0,
    sc_tips: num(row.sc_tips) ?? 0,
    nc_tips: num(row.nc_tips) ?? 0,
    tip_pay: num(row.tip_pay) ?? 0,
    gross_pay: num(row.gross_pay),
    has_missing_rate: row.has_missing_rate,
    warnings: row.warnings ?? [],
    pay_type: row.pay_type ?? null,
  };
}

// The table reads below accept an optional employeeId filter. For a regular
// employee it's unnecessary (own-row RLS already scopes every query — and the
// employees lookup that would provide the id is manager-only readable today),
// but a manager ALSO matches manager_full_access, so their unfiltered reads
// would return the whole org. Callers pass the id when they can resolve it
// (managers can) and null otherwise.

/** Own timecards inside [startDate, endDate], chronological. */
export async function getMyTimecards(
  startDate: string,
  endDate: string,
  employeeId: string | null = null
): Promise<Timecard[]> {
  let query = supabase
    .from("timecards")
    .select(
      "id, date, clock_in, clock_out, break_minutes, regular_hours, ot_hours, training_hours, status"
    )
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });
  if (employeeId) {
    query = query.eq("employee_id", employeeId);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/**
 * Own lateness incidents since sinceDate ("yyyy-MM-dd"). tier2Count uses the
 * lateness_tier stamped on the linked timecard at approval time.
 */
export async function getMyLatenessSummary(
  sinceDate: string,
  employeeId: string | null = null
): Promise<LatenessSummary> {
  let query = supabase
    .from("lateness_history")
    .select("id, date, timecards ( lateness_tier )")
    .gte("date", sinceDate);
  if (employeeId) {
    query = query.eq("employee_id", employeeId);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  const rows = data ?? [];
  return {
    count: rows.length,
    tier2Count: rows.filter((r) => r.timecards?.lateness_tier === 2).length,
  };
}

/**
 * Own callouts since sinceDate. Dates come back so the caller can also count
 * inside the (usually shorter) rolling threshold window.
 */
export async function getMyCalloutSummary(
  sinceDate: string,
  employeeId: string | null = null
): Promise<CalloutSummary> {
  let query = supabase
    .from("callout_history")
    .select("id, date")
    .gte("date", sinceDate)
    .order("date", { ascending: false });
  if (employeeId) {
    query = query.eq("employee_id", employeeId);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  const rows = data ?? [];
  return { count: rows.length, dates: rows.map((r) => r.date) };
}

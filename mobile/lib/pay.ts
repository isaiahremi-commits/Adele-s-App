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

// ── PR #27 item 9: calendar-year-to-date totals (migration 026) ──────────
export type YtdSummary = {
  year: number;
  regular_hours: number;
  ot_hours: number;
  training_hours: number;
  pto_hours: number;
  sc_tips: number;
  nc_tips: number;
  tip_pay: number;
  manager_amount: number;
  // null for salaried employees (no rate history — see migration 026).
  gross_pay: number | null;
  pay_type: string;
};

export async function getMyPayYtd(): Promise<YtdSummary | null> {
  const { data, error } = await supabase.rpc("pay_ytd_for_me");
  if (error) {
    throw new Error(error.message);
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) return null;
  const n = (v: unknown) => Number(v) || 0;
  return {
    year: n(row.year),
    regular_hours: n(row.regular_hours),
    ot_hours: n(row.ot_hours),
    training_hours: n(row.training_hours),
    pto_hours: n(row.pto_hours),
    sc_tips: n(row.sc_tips),
    nc_tips: n(row.nc_tips),
    tip_pay: n(row.tip_pay),
    manager_amount: n(row.manager_amount),
    gross_pay: row.gross_pay === null || row.gross_pay === undefined ? null : Number(row.gross_pay),
    pay_type: String(row.pay_type ?? "hourly"),
  };
}

// ── PR #27 item 10: per-incident lateness detail ─────────────────────────
// tc_lateness_range runs under the CALLER's RLS (deliberately un-guarded by
// 014) — an employee gets only their own incidents.
export type LatenessIncident = {
  shift_id: string | null;
  timecard_id: string;
  work_date: string;
  lateness_tier: number;
  minutes_late: number;
};

export async function getMyLatenessIncidents(
  startDate: string,
  endDate: string
): Promise<LatenessIncident[]> {
  const { data, error } = await supabase.rpc("tc_lateness_range", {
    p_start: startDate,
    p_end: endDate,
  });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? [])
    .map((r) => ({
      shift_id: r.shift_id ?? null,
      timecard_id: r.timecard_id,
      work_date: r.work_date,
      lateness_tier: Number(r.lateness_tier) || 0,
      minutes_late: Number(r.minutes_late) || 0,
    }))
    .sort((a, b) => b.work_date.localeCompare(a.work_date));
}

// ── PR #27 item 7: break punches (migration 025) ─────────────────────────
export type MyBreakState = {
  break1_in: string | null;
  break1_out: string | null;
  break2_in: string | null;
  break2_out: string | null;
  break_minutes: number;
};

/** The caller's own editable timecard's break state for a shift (null when
 * no timecard exists yet — the first punch creates one server-side). */
export async function getMyBreakState(shiftId: string): Promise<MyBreakState | null> {
  const { data, error } = await supabase
    .from("timecards")
    .select("break1_in, break1_out, break2_in, break2_out, break_minutes")
    .eq("shift_id", shiftId)
    .in("status", ["pending", "reviewed"])
    .limit(1)
    .maybeSingle();
  if (error) {
    // Pre-025 the columns don't exist — treat as "no punch data".
    return null;
  }
  return data
    ? {
        break1_in: data.break1_in ?? null,
        break1_out: data.break1_out ?? null,
        break2_in: data.break2_in ?? null,
        break2_out: data.break2_out ?? null,
        break_minutes: Number(data.break_minutes) || 0,
      }
    : null;
}

/** Stamp the next break punch (in → out → in → out) on today's shift. */
export async function punchBreak(shiftId: string): Promise<MyBreakState> {
  const { data, error } = await supabase.rpc("tc_break_punch", {
    p_shift_id: shiftId,
  });
  if (error) {
    throw new Error(error.message);
  }
  const row = data as Record<string, unknown> | null;
  return {
    break1_in: (row?.break1_in as string | null) ?? null,
    break1_out: (row?.break1_out as string | null) ?? null,
    break2_in: (row?.break2_in as string | null) ?? null,
    break2_out: (row?.break2_out as string | null) ?? null,
    break_minutes: Number(row?.break_minutes) || 0,
  };
}

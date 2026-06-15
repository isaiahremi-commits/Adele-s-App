// Server-side report computation for the Tier 2 accountability reports.
// Everything (minutes_late, tier, callout threshold flag) is computed LIVE from
// shifts + timecards + setup — nothing is cached. Shared by the three report
// API routes so the disciplinary union reuses the same logic.

import type { createClient } from "@/lib/supabase-server";
type DB = ReturnType<typeof createClient>;

function timeToMin(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}
// clock_in is timestamptz stored at UTC wall time; slice the time-of-day.
function isoTimeToMin(isoTs: string | null | undefined): number | null {
  if (!isoTs) return null;
  const t = isoTs.indexOf("T");
  return t >= 0 ? timeToMin(isoTs.slice(t + 1, t + 6)) : null;
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDaysISO(isoDate: string, n: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function employeeNameMap(supabase: DB): Promise<Record<string, string>> {
  const { data } = await supabase.from("employees").select("id, first_name, last_name");
  const map: Record<string, string> = {};
  for (const e of data ?? []) {
    map[e.id] = [e.first_name, e.last_name].filter(Boolean).join(" ").trim();
  }
  return map;
}

// Day-3 item 3: the set of employee_ids permitted by the department/outlet
// filters (AND logic). Returns null when neither filter is set (no filtering).
// Outlet matches the employee's home_outlet_id OR any employee_outlets row.
export async function allowedEmployeeIds(
  supabase: DB,
  deptId?: string | null,
  outletId?: string | null,
): Promise<Set<string> | null> {
  if (!deptId && !outletId) return null;
  const { data: emps } = await supabase.from("employees").select("id, department_id, home_outlet_id");
  let allowed = new Set((emps ?? []).map((e) => e.id as string));
  if (deptId) {
    allowed = new Set((emps ?? []).filter((e) => e.department_id === deptId).map((e) => e.id as string));
  }
  if (outletId) {
    const { data: eo } = await supabase.from("employee_outlets").select("employee_id").eq("outlet_id", outletId);
    const outletEmps = new Set<string>();
    for (const e of emps ?? []) if (e.home_outlet_id === outletId) outletEmps.add(e.id as string);
    for (const r of eo ?? []) outletEmps.add(r.employee_id as string);
    allowed = new Set(Array.from(allowed).filter((id) => outletEmps.has(id)));
  }
  return allowed;
}

export type LatenessIncident = {
  date: string; scheduled_start: string | null; clock_in: string | null; minutes_late: number; tier: number;
};
export type LatenessRow = {
  employee_id: string; name: string; tier1: number; tier2: number;
  avg_minutes: number; latest_date: string | null; incidents: LatenessIncident[];
};

export async function latenessReport(supabase: DB, start: string, end: string, deptId?: string | null, outletId?: string | null) {
  const [{ data: setup }, names, allowed] = await Promise.all([
    supabase.from("setup").select("lateness_tier1_minutes, lateness_tier2_minutes").limit(1).maybeSingle(),
    employeeNameMap(supabase),
    allowedEmployeeIds(supabase, deptId, outletId),
  ]);
  const t1 = setup?.lateness_tier1_minutes ?? 12;
  const t2 = setup?.lateness_tier2_minutes ?? 30;

  const { data } = await supabase
    .from("lateness_history")
    .select("id, date, employee_id, timecards(clock_in), shifts(start_time)")
    .gte("date", start)
    .lte("date", end);

  const byEmp = new Map<string, LatenessRow>();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const tc = r.timecards as { clock_in?: string } | null;
    const sh = r.shifts as { start_time?: string } | null;
    const ci = isoTimeToMin(tc?.clock_in ?? null);
    const ss = timeToMin(sh?.start_time ?? null);
    const minutes = ci != null && ss != null ? Math.max(0, ci - ss) : 0;
    const tier = minutes >= t2 ? 2 : minutes >= t1 ? 1 : 0;
    const eid = r.employee_id as string;
    if (!byEmp.has(eid)) byEmp.set(eid, { employee_id: eid, name: names[eid] ?? "—", tier1: 0, tier2: 0, avg_minutes: 0, latest_date: null, incidents: [] });
    const row = byEmp.get(eid)!;
    if (tier === 2) row.tier2++; else if (tier === 1) row.tier1++;
    row.incidents.push({ date: r.date as string, scheduled_start: sh?.start_time ?? null, clock_in: tc?.clock_in ?? null, minutes_late: minutes, tier });
    if (!row.latest_date || (r.date as string) > row.latest_date) row.latest_date = r.date as string;
  }
  const rows = Array.from(byEmp.values())
    .filter((r) => !allowed || allowed.has(r.employee_id))
    .map((r) => {
      const total = r.incidents.reduce((s, i) => s + i.minutes_late, 0);
      r.avg_minutes = r.incidents.length ? Math.round((total / r.incidents.length) * 10) / 10 : 0;
      r.incidents.sort((a, b) => a.date.localeCompare(b.date));
      return r;
    });
  rows.sort((a, b) => b.tier1 + b.tier2 - (a.tier1 + a.tier2));
  return { thresholds: { tier1_minutes: t1, tier2_minutes: t2 }, rows };
}

export type CalloutIncident = { date: string; shift_type: string | null; reason: string | null; entered_by: string | null };
export type CalloutRow = {
  employee_id: string; name: string; count: number; latest_date: string | null;
  threshold_flag: boolean; incidents: CalloutIncident[];
};

export async function calloutReport(supabase: DB, start: string, end: string, deptId?: string | null, outletId?: string | null) {
  const [{ data: setup }, names, allowed] = await Promise.all([
    supabase.from("setup").select("callout_threshold_count, callout_threshold_window_days").limit(1).maybeSingle(),
    employeeNameMap(supabase),
    allowedEmployeeIds(supabase, deptId, outletId),
  ]);
  const thresholdCount = setup?.callout_threshold_count ?? 3;
  const windowDays = setup?.callout_threshold_window_days ?? 30;

  // Rolling threshold check is independent of the display window: last N days from today.
  const today = todayISO();
  const rollStart = addDaysISO(today, -windowDays);
  const [{ data: inWindow }, { data: rolling }] = await Promise.all([
    supabase.from("callout_history").select("id, date, employee_id, reason, entered_by, shifts(shift_type)").gte("date", start).lte("date", end),
    supabase.from("callout_history").select("employee_id, date").gte("date", rollStart).lte("date", today),
  ]);

  const rollCount = new Map<string, number>();
  for (const r of rolling ?? []) rollCount.set(r.employee_id, (rollCount.get(r.employee_id) ?? 0) + 1);

  const byEmp = new Map<string, CalloutRow>();
  for (const r of (inWindow ?? []) as Array<Record<string, unknown>>) {
    const eid = r.employee_id as string;
    if (!byEmp.has(eid)) byEmp.set(eid, {
      employee_id: eid, name: names[eid] ?? "—", count: 0, latest_date: null,
      threshold_flag: (rollCount.get(eid) ?? 0) >= thresholdCount, incidents: [],
    });
    const row = byEmp.get(eid)!;
    row.count++;
    const sh = r.shifts as { shift_type?: string } | null;
    row.incidents.push({ date: r.date as string, shift_type: sh?.shift_type ?? null, reason: (r.reason as string) ?? null, entered_by: r.entered_by ? (names[r.entered_by as string] ?? null) : null });
    if (!row.latest_date || (r.date as string) > row.latest_date) row.latest_date = r.date as string;
  }
  const rows = Array.from(byEmp.values()).filter((r) => !allowed || allowed.has(r.employee_id));
  rows.forEach((r) => r.incidents.sort((a, b) => a.date.localeCompare(b.date)));
  rows.sort((a, b) => b.count - a.count);
  return { thresholds: { count: thresholdCount, window_days: windowDays }, rows };
}

export async function disciplinaryReport(supabase: DB, start: string, end: string, deptId?: string | null, outletId?: string | null) {
  const [lat, co] = await Promise.all([
    latenessReport(supabase, start, end, deptId, outletId),
    calloutReport(supabase, start, end, deptId, outletId),
  ]);
  const latMap = new Map(lat.rows.map((r) => [r.employee_id, r]));
  const coMap = new Map(co.rows.map((r) => [r.employee_id, r]));
  const ids = new Set<string>([...Array.from(latMap.keys()), ...Array.from(coMap.keys())]);

  const rows = Array.from(ids).map((eid) => {
    const l = latMap.get(eid);
    const c = coMap.get(eid);
    const tier1 = l?.tier1 ?? 0, tier2 = l?.tier2 ?? 0, callouts = c?.count ?? 0;
    const calloutFlag = c?.threshold_flag ?? false;
    const escalation = calloutFlag && tier2 > 0;
    // interleave incidents chronologically
    const feed = [
      ...(l?.incidents ?? []).map((i) => ({ date: i.date, type: "lateness" as const, detail: `Tier ${i.tier} · ${i.minutes_late} min late` })),
      ...(c?.incidents ?? []).map((i) => ({ date: i.date, type: "callout" as const, detail: i.reason ?? "Callout" })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    return {
      employee_id: eid, name: (l?.name ?? c?.name) ?? "—",
      tier1, tier2, callouts, total: tier1 + tier2 + callouts,
      callout_flag: calloutFlag, escalation, feed,
    };
  });
  rows.sort((a, b) => b.total - a.total);
  return { thresholds: { ...lat.thresholds, ...co.thresholds }, rows };
}

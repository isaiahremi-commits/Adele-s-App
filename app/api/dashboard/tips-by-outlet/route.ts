import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

function startOfCurrentWeekISO(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") === "biweekly" ? "biweekly" : "weekly";

  const supabase = createClient();

  const weekStart = startOfCurrentWeekISO();
  const rangeStart = range === "biweekly" ? addDaysISO(weekStart, -7) : weekStart;
  const rangeEnd = addDaysISO(weekStart, 6);

  const { data: sheets, error } = await supabase
    .from("tip_sheets")
    .select("id, outlet_id, status, service_charge, non_cash_tips, date")
    .gte("date", rangeStart)
    .lte("date", rangeEnd);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: outlets, error: oErr } = await supabase
    .from("outlets")
    .select("id, name, department_id, departments(name, type)");

  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });

  const byOutlet: Record<string, {
    outlet_id: string;
    name: string;
    dept_name: string;
    approved_total: number;
    approved_count: number;
    pending_total: number;
    pending_count: number;
    service_charge: number;
    non_cash: number;
  }> = {};

  for (const o of outlets ?? []) {
    const dept = o.departments as { name?: string } | { name?: string }[] | null;
    const deptName = Array.isArray(dept) ? dept[0]?.name ?? "" : dept?.name ?? "";
    byOutlet[o.id] = {
      outlet_id: o.id,
      name: o.name,
      dept_name: deptName,
      approved_total: 0,
      approved_count: 0,
      pending_total: 0,
      pending_count: 0,
      service_charge: 0,
      non_cash: 0,
    };
  }

  for (const s of sheets ?? []) {
    if (!s.outlet_id || !byOutlet[s.outlet_id]) continue;
    const bucket = byOutlet[s.outlet_id];
    const sc = Number(s.service_charge ?? 0);
    const nc = Number(s.non_cash_tips ?? 0);
    const total = sc + nc;
    bucket.service_charge += sc;
    bucket.non_cash += nc;
    if (s.status === "approved") {
      bucket.approved_total += total;
      bucket.approved_count += 1;
    } else {
      bucket.pending_total += total;
      bucket.pending_count += 1;
    }
  }

  const result = Object.values(byOutlet).filter(
    (o) => o.approved_count > 0 || o.pending_count > 0
  );

  return NextResponse.json({ range, range_start: rangeStart, range_end: rangeEnd, outlets: result });
}

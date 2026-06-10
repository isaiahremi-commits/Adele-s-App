import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { cycleLength, currentPeriod, todayISO } from "@/lib/payroll";

type Row = {
  outlet_name: string | null;
  department: string | null;
  gross_pay: string | number | null;
  has_missing_rate: boolean;
};

function cents(n: string | number | null): number {
  if (n === null) return 0;
  return Math.round(Number(n) * 100);
}

// GET /api/dashboard/payroll-prediction
// Period-to-date predicted payroll for the current period, by outlet + department.
export async function GET() {
  const supabase = createClient();

  const setup = await supabase.from("setup").select("pay_cycle").limit(1).maybeSingle();
  const cycle = cycleLength(setup.data?.pay_cycle ?? "biweekly");
  const period = currentPeriod(cycle, todayISO());

  const { data, error } = await supabase.rpc("pay_breakdown", {
    p_start: period.start,
    p_end: period.end,
    p_mode: "prediction",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Row[];
  let totalCents = 0;
  let incomplete = false;
  const outletMap = new Map<string, number>();
  const deptMap = new Map<string, number>();

  for (const r of rows) {
    const c = cents(r.gross_pay);
    totalCents += c;
    if (r.has_missing_rate) incomplete = true;
    const o = r.outlet_name || "Unassigned";
    const d = r.department || "Unassigned";
    outletMap.set(o, (outletMap.get(o) ?? 0) + c);
    deptMap.set(d, (deptMap.get(d) ?? 0) + c);
  }

  const toList = (m: Map<string, number>) =>
    Array.from(m.entries())
      .map(([name, c]) => ({ name, total: c / 100 }))
      .sort((a, b) => b.total - a.total);

  return NextResponse.json({
    period_start: period.start,
    period_end: period.end,
    total: totalCents / 100,
    incomplete,
    by_outlet: toList(outletMap),
    by_department: toList(deptMap),
  });
}

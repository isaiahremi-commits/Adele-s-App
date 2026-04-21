import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tip_allocations")
    .select("employee_id, service_charge_amount, non_cash_amount, total_amount");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const totals: Record<string, { total_tips: number; total_sc: number; total_nc: number }> = {};
  for (const row of data ?? []) {
    const id = row.employee_id as string;
    if (!id) continue;
    if (!totals[id]) totals[id] = { total_tips: 0, total_sc: 0, total_nc: 0 };
    totals[id].total_sc += Number(row.service_charge_amount ?? 0);
    totals[id].total_nc += Number(row.non_cash_amount ?? 0);
    totals[id].total_tips += Number(row.total_amount ?? 0);
  }

  return NextResponse.json(totals);
}

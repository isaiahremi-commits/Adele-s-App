import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// PR #29 item 5: year-to-date tip totals per employee for the Employees
// page detail card. Previously this summed the DEAD tip_allocations table
// (nothing has written it since the Tier-1 engine) with no date bound and
// no pagination — Migration 028's employee_tip_totals_ytd RPC is the honest
// source: tip_sheet_rows on approved/posted sheets, Jan 1 → today, grouped
// in SQL (mirrors pay_ytd_for_me's filters).

export async function GET() {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("employee_tip_totals_ytd");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const totals: Record<string, { total_tips: number; total_sc: number; total_nc: number }> = {};
  for (const row of data ?? []) {
    if (!row.employee_id) continue;
    totals[row.employee_id] = {
      total_tips: Number(row.total_tips ?? 0),
      total_sc: Number(row.total_sc ?? 0),
      total_nc: Number(row.total_nc ?? 0),
    };
  }

  return NextResponse.json(totals);
}

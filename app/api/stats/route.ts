import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [staffToday, tipsDist, pending, employees] = await Promise.all([
    supabase.from("shifts").select("employee_id", { count: "exact", head: true }).eq("shift_date", today),
    supabase.from("tip_sheets").select("service_charge, non_cash_tips").eq("status", "approved"),
    supabase.from("tip_sheets").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("employees").select("id", { count: "exact", head: true }).eq("active", true),
  ]);

  const tipsTotal =
    (tipsDist.data ?? []).reduce(
      (sum, r: { service_charge: number | null; non_cash_tips: number | null }) =>
        sum + Number(r.service_charge ?? 0) + Number(r.non_cash_tips ?? 0),
      0
    );

  return NextResponse.json({
    staff_on_today: staffToday.count ?? 0,
    tips_distributed: tipsTotal,
    pending_tip_sheets: pending.count ?? 0,
    total_employees: employees.count ?? 0,
  });
}

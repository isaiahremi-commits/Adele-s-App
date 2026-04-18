import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);

  // Staff on today: count shifts where date = today. The shifts table uses
  // `date` (not `shift_date`).
  const staffTodayPromise = supabase
    .from("shifts")
    .select("employee_id", { count: "exact", head: true })
    .eq("date", today);

  // Tips distributed: sum of service_charge + non_cash_tips across all
  // approved sheets (so it reflects what's actually been paid out).
  const tipsApprovedPromise = supabase
    .from("tip_sheets")
    .select("service_charge, non_cash_tips")
    .eq("status", "approved");

  const pendingPromise = supabase
    .from("tip_sheets")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  // Total employees — don't filter on `active` (column may not exist in prod).
  const employeesPromise = supabase
    .from("employees")
    .select("id", { count: "exact", head: true });

  const [staffToday, tipsApproved, pending, employees] = await Promise.all([
    staffTodayPromise,
    tipsApprovedPromise,
    pendingPromise,
    employeesPromise,
  ]);

  const tipsTotal = (tipsApproved.data ?? []).reduce(
    (sum: number, r: { service_charge: number | null; non_cash_tips: number | null }) =>
      sum + Number(r.service_charge ?? 0) + Number(r.non_cash_tips ?? 0),
    0
  );

  return NextResponse.json({
    staff_on_today: staffToday.count ?? 0,
    tips_distributed: tipsTotal,
    pending_tip_sheets: pending.count ?? 0,
    total_employees: employees.count ?? 0,
    // Echo any errors so the UI can show them (optional).
    _errors: {
      staff_today: staffToday.error?.message ?? null,
      tips_approved: tipsApproved.error?.message ?? null,
      pending: pending.error?.message ?? null,
      employees: employees.error?.message ?? null,
    },
  });
}

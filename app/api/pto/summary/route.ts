import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// GET /api/pto/summary?employee_id=... — balance + recent ledger + pending count.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employee_id");
  if (!employeeId) return NextResponse.json({ error: "employee_id required" }, { status: 400 });

  const supabase = createClient();
  const { data, error } = await supabase.rpc("pto_summary", { p_employee_id: employeeId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

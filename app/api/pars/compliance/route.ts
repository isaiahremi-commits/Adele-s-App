import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// GET /api/pars/compliance?start=YYYY-MM-DD — required vs scheduled for the
// 7-day window starting at `start` (manager-gated in SQL). Rows carry
// has_par so the UI only alerts on configured requirements.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return NextResponse.json({ error: "start (YYYY-MM-DD) is required" }, { status: 400 });
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("par_compliance_for_week", { p_start_date: start });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

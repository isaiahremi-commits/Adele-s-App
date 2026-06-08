import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// GET /api/timecards/lateness?start=YYYY-MM-DD&end=YYYY-MM-DD
// Read-time lateness for the scheduling grid flags. minutes_late is computed
// in SQL from shift.start_time vs timecards.clock_in (never stored).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!start || !end) return NextResponse.json({ error: "start and end are required" }, { status: 400 });

  const supabase = createClient();
  const { data, error } = await supabase.rpc("tc_lateness_range", {
    p_start: start,
    p_end: end,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// GET /api/payroll?start=YYYY-MM-DD&end=YYYY-MM-DD&mode=actual|prediction
// Read-only per-employee pay breakdown for the period via the pay_breakdown RPC.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const mode = searchParams.get("mode") === "prediction" ? "prediction" : "actual";
  if (!start || !end) return NextResponse.json({ error: "start and end are required" }, { status: 400 });

  const supabase = createClient();
  const { data, error } = await supabase.rpc("pay_breakdown", {
    p_start: start,
    p_end: end,
    p_mode: mode,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/payroll  { action: "post_period", start, end }
// The only write: locks the window by moving approved -> posted (transactional).
export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  if (body.action !== "post_period") {
    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
  const supabase = createClient();
  const { data, error } = await supabase.rpc("pay_post_period", {
    p_start: body.start,
    p_end: body.end,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// GET /api/approved-weeks?period_start=YYYY-MM-DD
//   -> { approved_outlets: string[] }  (outlet_ids approved for that week)
// GET /api/approved-weeks?start=&end=
//   -> distinct approved period_start_date in range (legacy list shape)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const periodStart = searchParams.get("period_start");
  const supabase = createClient();

  if (periodStart) {
    const { data, error } = await supabase
      .from("approved_weeks")
      .select("outlet_id")
      .eq("period_start_date", periodStart);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const approved_outlets = (data ?? []).map((r) => r.outlet_id).filter(Boolean);
    return NextResponse.json({ approved_outlets });
  }

  const start = searchParams.get("start"), end = searchParams.get("end");
  let q = supabase.from("approved_weeks").select("period_start_date");
  if (start) q = q.gte("period_start_date", start);
  if (end) q = q.lte("period_start_date", end);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const weeks = Array.from(new Set((data ?? []).map((r) => r.period_start_date)));
  return NextResponse.json(weeks);
}

// POST /api/approved-weeks  { period_start, outlet_ids: string[] }
//   -> marks the week approved for each outlet (one row per outlet, upsert).
export async function POST(req: Request) {
  const body = (await req.json()) as { period_start?: string; outlet_ids?: string[] };
  if (!body.period_start) return NextResponse.json({ error: "period_start required" }, { status: 400 });
  const outletIds = (body.outlet_ids ?? []).filter(Boolean);
  if (outletIds.length === 0) return NextResponse.json({ error: "outlet_ids required" }, { status: 400 });
  const supabase = createClient();

  // Actor = the Restaurant Manager (the authenticated user under RLS).
  const { data: mgr } = await supabase
    .from("employees")
    .select("id")
    .eq("title", "Restaurant Manager")
    .limit(1)
    .maybeSingle();

  const rows = outletIds.map((outlet_id) => ({
    period_start_date: body.period_start,
    outlet_id,
    approved_at: new Date().toISOString(),
    approved_by: mgr?.id ?? null,
  }));
  const { data, error } = await supabase
    .from("approved_weeks")
    .upsert(rows, { onConflict: "period_start_date,outlet_id" })
    .select();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ approved_outlets: (data ?? []).map((r) => r.outlet_id) });
}

// DELETE /api/approved-weeks  { period_start, outlet_ids: string[] }
//   -> unapproves the week for each outlet (deletes the approved_weeks rows).
export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { period_start?: string; outlet_ids?: string[] };
  if (!body.period_start) return NextResponse.json({ error: "period_start required" }, { status: 400 });
  const outletIds = (body.outlet_ids ?? []).filter(Boolean);
  if (outletIds.length === 0) return NextResponse.json({ error: "outlet_ids required" }, { status: 400 });
  const supabase = createClient();

  const { error } = await supabase
    .from("approved_weeks")
    .delete()
    .eq("period_start_date", body.period_start)
    .in("outlet_id", outletIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

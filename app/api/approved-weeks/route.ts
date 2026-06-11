import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// GET /api/approved-weeks?period_start=YYYY-MM-DD -> { approved: boolean }
// GET /api/approved-weeks?start=&end= -> list of approved period_start_date in range
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const periodStart = searchParams.get("period_start");
  const supabase = createClient();

  if (periodStart) {
    const { data, error } = await supabase
      .from("approved_weeks")
      .select("period_start_date")
      .eq("period_start_date", periodStart)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ approved: !!data });
  }

  const start = searchParams.get("start"), end = searchParams.get("end");
  let q = supabase.from("approved_weeks").select("period_start_date");
  if (start) q = q.gte("period_start_date", start);
  if (end) q = q.lte("period_start_date", end);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data ?? []).map((r) => r.period_start_date));
}

// POST /api/approved-weeks  { period_start } -> marks the week approved (upsert).
export async function POST(req: Request) {
  const body = (await req.json()) as { period_start?: string };
  if (!body.period_start) return NextResponse.json({ error: "period_start required" }, { status: 400 });
  const supabase = createClient();

  // Actor = the Restaurant Manager (the authenticated user under RLS).
  const { data: mgr } = await supabase
    .from("employees")
    .select("id")
    .eq("title", "Restaurant Manager")
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("approved_weeks")
    .upsert({ period_start_date: body.period_start, approved_at: new Date().toISOString(), approved_by: mgr?.id ?? null }, { onConflict: "period_start_date" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

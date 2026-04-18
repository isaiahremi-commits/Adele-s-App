import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const supabase = createClient();
  let q = supabase.from("shifts").select("*, employees(name, department, position)").order("shift_date");
  if (start) q = q.gte("shift_date", start);
  if (end) q = q.lte("shift_date", end);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const body = await req.json();
  const supabase = createClient();
  const { data, error } = await supabase.from("shifts").insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

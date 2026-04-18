import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const outletId = searchParams.get("outlet_id");
  const supabase = createClient();
  let q = supabase.from("services").select("*").order("name");
  if (outletId) q = q.eq("outlet_id", outletId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const body = await req.json();
  const supabase = createClient();
  const { data, error } = await supabase.from("services").insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

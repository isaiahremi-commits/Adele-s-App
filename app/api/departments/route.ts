import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("departments")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const payload = {
    name: (body.name as string) || "Untitled",
    type: (body.type as string) || "custom",
    tip_pool_strategy: (body.tip_pool_strategy as string) || "per_outlet_per_shift",
  };
  const supabase = createClient();
  const { data, error } = await supabase.from("departments").insert(payload).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

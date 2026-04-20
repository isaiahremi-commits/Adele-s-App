import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("outlets")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const payload: Record<string, unknown> = {
    name: (body.name as string) || "Untitled Outlet",
  };
  if (body.department_id) payload.department_id = body.department_id;

  const supabase = createClient();
  const { data, error } = await supabase.from("outlets").insert(payload).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

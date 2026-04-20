import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = createClient();
  const { data, error } = await supabase.from("departments").select("*").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const body = (await req.json()) as { name?: string };
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const supabase = createClient();
  const { data, error } = await supabase
    .from("departments")
    .insert({ name })
    .select()
    .single();
  if (error)
    return NextResponse.json(
      { error: error.message, details: error.details, hint: error.hint, code: error.code },
      { status: 500 }
    );
  return NextResponse.json(data);
}

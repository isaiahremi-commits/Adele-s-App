import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// POST /api/departments/upsert { name, id? } — create (no id) or rename.
// Manager-gated + case-insensitive dup check in SQL (department_upsert).
export async function POST(req: Request) {
  const body = (await req.json()) as { name?: string; id?: string };
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const supabase = createClient();
  const { data, error } = await supabase.rpc("department_upsert", {
    p_name: body.name,
    p_id: body.id ?? undefined,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data });
}

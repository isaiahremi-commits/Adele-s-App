import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { role_name, position_name, ...rest } = body as {
    role_name?: string;
    position_name?: string;
  } & Record<string, unknown>;
  const payload: Record<string, unknown> = { ...rest };
  const name = position_name ?? role_name;
  if (name !== undefined) payload.position_name = name;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("outlet_roles")
    .update(payload)
    .eq("id", params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = data as { position_name?: string | null };
  return NextResponse.json({ ...data, role_name: row.position_name ?? "" });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { error } = await supabase.from("outlet_roles").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

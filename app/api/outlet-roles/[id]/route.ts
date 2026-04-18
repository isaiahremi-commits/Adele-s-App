import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const supabase = createClient();
  const { data, error } = await supabase.from("outlet_roles").update(body).eq("id", params.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { error } = await supabase.from("outlet_roles").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

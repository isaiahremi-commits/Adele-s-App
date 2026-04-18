import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: sheet, error } = await supabase
    .from("tip_sheets")
    .select("*")
    .eq("id", params.id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: managers } = await supabase
    .from("tip_event_managers")
    .select("*, employees(name)")
    .eq("tip_sheet_id", params.id);
  const { data: allocations } = await supabase
    .from("tip_allocations")
    .select("*, employees(name)")
    .eq("tip_sheet_id", params.id);
  return NextResponse.json({ sheet, managers: managers ?? [], allocations: allocations ?? [] });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const supabase = createClient();
  const { data, error } = await supabase.from("tip_sheets").update(body).eq("id", params.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { error } = await supabase.from("tip_sheets").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

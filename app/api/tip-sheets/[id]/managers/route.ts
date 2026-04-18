import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { employee_id } = await req.json();
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tip_event_managers")
    .insert({ tip_sheet_id: params.id, employee_id })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  const managerId = searchParams.get("manager_id");
  const supabase = createClient();
  const { error } = await supabase
    .from("tip_event_managers")
    .delete()
    .eq("id", managerId)
    .eq("tip_sheet_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { shift_date, date, ...rest } = body as {
    shift_date?: string;
    date?: string;
  } & Record<string, unknown>;
  const payload: Record<string, unknown> = { ...rest };
  const d = date ?? shift_date;
  if (d !== undefined) payload.date = d;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("shifts")
    .update(payload)
    .eq("id", params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = data as { date?: string };
  return NextResponse.json({ ...data, shift_date: row.date ?? null });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { error } = await supabase.from("shifts").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

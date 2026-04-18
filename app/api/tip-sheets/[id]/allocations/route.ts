import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// Bulk replace allocations for a tip sheet. Body: { allocations: [...] }
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const { allocations } = await req.json();
  const supabase = createClient();

  const { error: delErr } = await supabase
    .from("tip_allocations")
    .delete()
    .eq("tip_sheet_id", params.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  if (!allocations?.length) return NextResponse.json([]);

  const rows = allocations.map((a: Record<string, unknown>) => ({ ...a, tip_sheet_id: params.id }));
  const { data, error } = await supabase.from("tip_allocations").insert(rows).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tip_allocations")
    .insert({ ...body, tip_sheet_id: params.id })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

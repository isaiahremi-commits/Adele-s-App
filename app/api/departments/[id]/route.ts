import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { error } = await supabase.from("departments").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const body = (await req.json()) as Record<string, unknown>;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("departments")
    .update({
      name: body.name,
      type: body.type,
      tip_pool_strategy: body.tip_pool_strategy,
    })
    .eq("id", params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

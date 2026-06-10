import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// Large party revenue management for a tip sheet. Commission (20/3/2) is
// populated when ts_compute runs; these endpoints just manage the rows.

// POST { revenue, manager_employee_id? } — declare a large party.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json()) as { revenue?: number; manager_employee_id?: string };
  const supabase = createClient();
  const { data, error } = await supabase.rpc("ts_add_large_party", {
    p_tip_sheet_id: params.id,
    p_revenue: Number(body.revenue ?? 0),
    p_manager_employee_id: body.manager_employee_id ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

// PATCH { large_party_id, manager_employee_id } — reassign the Restaurant Manager.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json()) as { large_party_id?: string; manager_employee_id?: string };
  if (!body.large_party_id) return NextResponse.json({ error: "large_party_id required" }, { status: 400 });
  const supabase = createClient();
  const { data, error } = await supabase.rpc("ts_reassign_manager", {
    p_lpr_id: body.large_party_id,
    p_manager_employee_id: body.manager_employee_id ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

// DELETE ?large_party_id=... — remove a declared large party.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  const lpId = searchParams.get("large_party_id");
  if (!lpId) return NextResponse.json({ error: "large_party_id required" }, { status: 400 });
  const supabase = createClient();
  const { error } = await supabase
    .from("large_party_revenues")
    .delete()
    .eq("id", lpId)
    .eq("tip_sheet_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

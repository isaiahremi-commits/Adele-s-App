import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// Position assignment on one outlet (outlet_roles via the 027 RPCs).

// POST /api/outlets/:id/positions { position_name, points? } — assign the
// position (or update its points). is_tipped / tip-out config is preserved.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json()) as { position_name?: string; points?: number };
  if (!body.position_name?.trim()) {
    return NextResponse.json({ error: "position_name is required" }, { status: 400 });
  }
  const supabase = createClient();
  const { data, error } = await supabase.rpc("outlet_assign_position", {
    p_outlet_id: params.id,
    p_position_name: body.position_name,
    p_points: body.points ?? 1,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ role_id: data });
}

// DELETE /api/outlets/:id/positions?position_name=... — unassign.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  const positionName = searchParams.get("position_name");
  if (!positionName) {
    return NextResponse.json({ error: "position_name is required" }, { status: 400 });
  }
  const supabase = createClient();
  const { data, error } = await supabase.rpc("outlet_unassign_position", {
    p_outlet_id: params.id,
    p_position_name: positionName,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ removed: data ?? 0 });
}

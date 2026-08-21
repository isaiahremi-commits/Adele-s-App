import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// GET /api/outlets/:id/detail — everything the outlet page needs in one
// call: the outlet + parent department, the department's position catalog
// with per-position assignment state, and the assigned team members.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("outlet_detail", { p_outlet_id: params.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? {});
}

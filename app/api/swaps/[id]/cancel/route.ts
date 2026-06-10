import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// POST /api/swaps/:id/cancel — delete a pending swap (shift unchanged).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("swap_cancel", { p_swap_id: params.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

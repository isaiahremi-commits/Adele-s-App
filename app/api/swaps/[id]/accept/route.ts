import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// POST /api/swaps/:id/accept — complete the swap + reassign the shift (transactional).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("swap_accept", { p_swap_id: params.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// POST /api/tip-sheets/:id/compute — run the tip engine (transactional RPC).
// Writes tip_sheet_rows.tip_amount + large_party_revenues amounts and
// transitions the sheet to 'ready'. Idempotent.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("ts_compute", { p_tip_sheet_id: params.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// PATCH /api/tip-sheets/:id/rows
//   { row_id, declared_service_charge?, declared_non_cash? }
// Individual-mode per-employee entry. tip_amount is computed by ts_compute,
// never set here.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json()) as {
    row_id?: string;
    declared_service_charge?: number;
    declared_non_cash?: number;
  };
  if (!body.row_id) return NextResponse.json({ error: "row_id required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body.declared_service_charge !== undefined) patch.declared_service_charge = Number(body.declared_service_charge) || 0;
  if (body.declared_non_cash !== undefined) patch.declared_non_cash = Number(body.declared_non_cash) || 0;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("tip_sheet_rows")
    .update(patch)
    .eq("id", body.row_id)
    .eq("tip_sheet_id", params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

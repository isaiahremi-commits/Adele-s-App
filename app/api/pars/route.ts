import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// GET /api/pars?outlet_id=... — all pars for one outlet (manager-gated in SQL).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const outletId = searchParams.get("outlet_id");
  if (!outletId) return NextResponse.json({ error: "outlet_id is required" }, { status: 400 });

  const supabase = createClient();
  const { data, error } = await supabase.rpc("par_list_for_outlet", { p_outlet_id: outletId });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

// POST /api/pars  { outlet_id, pars: [{ day_of_week, position_name, required_count }] }
// Upserts each cell; a required_count of 0 removes the requirement (the
// Setup editor's "empty = no requirement" semantic — par_delete).
export async function POST(req: Request) {
  const body = (await req.json()) as {
    outlet_id?: string;
    pars?: Array<{ day_of_week: number; position_name: string; required_count: number }>;
  };
  if (!body.outlet_id || !Array.isArray(body.pars)) {
    return NextResponse.json({ error: "outlet_id and pars[] are required" }, { status: 400 });
  }

  const supabase = createClient();
  let saved = 0;
  for (const p of body.pars) {
    const count = Number(p.required_count) || 0;
    const { error } = count > 0
      ? await supabase.rpc("par_upsert", {
          p_outlet_id: body.outlet_id,
          p_day_of_week: p.day_of_week,
          p_position_name: p.position_name,
          p_required_count: count,
        })
      : await supabase.rpc("par_delete", {
          p_outlet_id: body.outlet_id,
          p_day_of_week: p.day_of_week,
          p_position_name: p.position_name,
        });
    if (error) {
      return NextResponse.json({ error: error.message, saved }, { status: 400 });
    }
    saved++;
  }
  return NextResponse.json({ saved });
}

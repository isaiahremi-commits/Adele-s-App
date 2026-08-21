import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// POST /api/outlets/upsert { department_id, name, tip_pool_mode?, id? }
// Create under a department (mode defaults to pool_daily in SQL) or update
// name / mode / department. Manager-gated + validated in SQL (outlet_upsert).
export async function POST(req: Request) {
  const body = (await req.json()) as {
    department_id?: string;
    name?: string;
    tip_pool_mode?: string;
    id?: string;
  };
  if (!body.department_id || !body.name?.trim()) {
    return NextResponse.json(
      { error: "department_id and name are required" },
      { status: 400 }
    );
  }
  const supabase = createClient();
  const { data, error } = await supabase.rpc("outlet_upsert", {
    p_department_id: body.department_id,
    p_name: body.name,
    p_tip_pool_mode: body.tip_pool_mode ?? undefined,
    p_id: body.id ?? undefined,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data });
}

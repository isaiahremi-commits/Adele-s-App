import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// GET /api/departments/:id/outlets — the department page's outlet cards:
// id, name, tip_pool_mode, position_count, employee_count.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("outlet_list_for_department", {
    p_department_id: params.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// GET /api/departments/list — the Establishment page's department cards:
// id, name, type (legacy FOH/BOH chip), outlet_count, position_count.
// Manager-gated in SQL (department_list).
export async function GET() {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("department_list");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

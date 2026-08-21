import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// The department's position catalog (department_positions).

// GET /api/departments/positions?department_id=...
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const departmentId = searchParams.get("department_id");
  if (!departmentId) {
    return NextResponse.json({ error: "department_id is required" }, { status: 400 });
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("department_positions")
    .select("id, department_id, position_name")
    .eq("department_id", departmentId)
    .order("position_name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/departments/positions { department_id, position_name }
export async function POST(req: Request) {
  const body = (await req.json()) as { department_id?: string; position_name?: string };
  if (!body.department_id || !body.position_name?.trim()) {
    return NextResponse.json(
      { error: "department_id and position_name are required" },
      { status: 400 }
    );
  }
  const supabase = createClient();
  const { data, error } = await supabase.rpc("department_position_add", {
    p_department_id: body.department_id,
    p_position_name: body.position_name,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data });
}

// DELETE /api/departments/positions?department_id=...&position_name=...
// Refuses in SQL while the position is still assigned to any outlet.
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const departmentId = searchParams.get("department_id");
  const positionName = searchParams.get("position_name");
  if (!departmentId || !positionName) {
    return NextResponse.json(
      { error: "department_id and position_name are required" },
      { status: 400 }
    );
  }
  const supabase = createClient();
  const { data, error } = await supabase.rpc("department_position_remove", {
    p_department_id: departmentId,
    p_position_name: positionName,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ removed: data ?? 0 });
}

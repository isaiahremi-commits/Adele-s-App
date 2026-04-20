import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// employee_outlets: id, employee_id, outlet_id, position_name

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employee_id");
  const supabase = createClient();
  let q = supabase.from("employee_outlets").select("*");
  if (employeeId) q = q.eq("employee_id", employeeId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    employee_id?: string;
    outlet_id?: string;
    position_name?: string;
    assignments?: { outlet_id: string; position_name: string }[];
    replace?: boolean;
  };
  const supabase = createClient();

  // Bulk replace mode: delete then insert all assignments for an employee.
  if (body.replace && body.employee_id) {
    const { error: delErr } = await supabase
      .from("employee_outlets")
      .delete()
      .eq("employee_id", body.employee_id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    const rows = (body.assignments ?? [])
      .filter((a) => a.outlet_id)
      .map((a) => ({
        employee_id: body.employee_id,
        outlet_id: a.outlet_id,
        position_name: a.position_name || null,
      }));
    if (rows.length === 0) return NextResponse.json([]);
    const { data, error } = await supabase.from("employee_outlets").insert(rows).select();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  }

  // Single insert.
  const { data, error } = await supabase
    .from("employee_outlets")
    .insert({
      employee_id: body.employee_id,
      outlet_id: body.outlet_id,
      position_name: body.position_name ?? null,
    })
    .select()
    .single();
  if (error)
    return NextResponse.json(
      { error: error.message, details: error.details, hint: error.hint, code: error.code },
      { status: 500 }
    );
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const supabase = createClient();
  const { error } = await supabase.from("employee_outlets").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

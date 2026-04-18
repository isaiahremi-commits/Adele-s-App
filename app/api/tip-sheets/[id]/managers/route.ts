import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// tip_event_managers: id, tip_sheet_id, employee_id, commission_pct, created_at
// Commission percent is deducted from service_charge before the team split.

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json()) as { employee_id?: string; commission_pct?: number };
  const employee_id = body.employee_id;
  const commission_pct = Number(body.commission_pct ?? 0);

  const supabase = createClient();
  const { data, error } = await supabase
    .from("tip_event_managers")
    .insert({ tip_sheet_id: params.id, employee_id, commission_pct })
    .select()
    .single();
  if (error) {
    console.error("managers POST failed", { error });
    return NextResponse.json(
      { error: error.message, details: error.details, hint: error.hint, code: error.code },
      { status: 500 }
    );
  }
  return NextResponse.json(data);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json()) as { manager_id?: string; commission_pct?: number };
  const manager_id = body.manager_id;
  if (!manager_id) {
    return NextResponse.json({ error: "manager_id required" }, { status: 400 });
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tip_event_managers")
    .update({ commission_pct: Number(body.commission_pct ?? 0) })
    .eq("id", manager_id)
    .eq("tip_sheet_id", params.id)
    .select()
    .single();
  if (error) {
    return NextResponse.json(
      { error: error.message, details: error.details, hint: error.hint, code: error.code },
      { status: 500 }
    );
  }
  return NextResponse.json(data);
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  const managerId = searchParams.get("manager_id");
  const supabase = createClient();
  const { error } = await supabase
    .from("tip_event_managers")
    .delete()
    .eq("id", managerId)
    .eq("tip_sheet_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

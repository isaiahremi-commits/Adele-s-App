import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

async function approve(id: string) {
  const supabase = createClient();
  // tip_sheets columns: id, department, service_name, shift_type, date,
  // service_charge, non_cash_tips, status, created_at. Only update status.
  const { data, error } = await supabase
    .from("tip_sheets")
    .update({ status: "approved" })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    console.error("approve tip-sheet failed", { id, error });
    return NextResponse.json(
      { error: error.message, details: error.details, hint: error.hint, code: error.code },
      { status: 500 }
    );
  }
  return NextResponse.json(data);
}

export async function PATCH(_req: Request, { params }: { params: { id: string } }) {
  return approve(params.id);
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return approve(params.id);
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

type TipSheetRow = {
  id: string;
  date?: string | null;
  sheet_date?: string | null;
  [key: string]: unknown;
};

function toClient(row: TipSheetRow) {
  return { ...row, sheet_date: row.date ?? row.sheet_date ?? null };
}

export async function GET() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tip_sheets")
    .select("*")
    .order("date", { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: error.message, details: error.details, hint: error.hint, code: error.code },
      { status: 500 }
    );
  }
  return NextResponse.json((data ?? []).map(toClient));
}

export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;

  const dateValue = (body.date ?? body.sheet_date) as string | undefined;

  const payload: Record<string, unknown> = {
    department: body.department || null,
    service_name: body.service_name || null,
    shift_type: body.shift_type || null,
    date: dateValue || null,
    service_charge: Number(body.service_charge ?? 0),
    non_cash_tips: Number(body.non_cash_tips ?? 0),
    status: (body.status as string) || "pending",
    source: (body.source as string) || "manual",
  };

  if (body.outlet_id) payload.outlet_id = body.outlet_id;
  if (body.week_start) payload.week_start = body.week_start;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("tip_sheets")
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error("POST /api/tip-sheets failed", { payload, error });
    return NextResponse.json(
      {
        error: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        payload,
      },
      { status: 500 }
    );
  }
  return NextResponse.json(toClient(data as TipSheetRow));
}

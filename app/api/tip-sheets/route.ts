import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// tip_sheets columns:
//   id, department, service_name, shift_type, date,
//   service_charge, non_cash_tips, status, created_at
// No outlet_id / service_id columns — drop them if the client sends them.

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

  // Whitelist to the exact column set of tip_sheets. Anything else (outlet_id,
  // service_id, sheet_date, etc.) is intentionally NOT included.
  const payload: Record<string, unknown> = {
    department: body.department || null,
    service_name: body.service_name || null,
    shift_type: body.shift_type || null,
    date: dateValue || null,
    service_charge: Number(body.service_charge ?? 0),
    non_cash_tips: Number(body.non_cash_tips ?? 0),
    status: (body.status as string) || "pending",
  };

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

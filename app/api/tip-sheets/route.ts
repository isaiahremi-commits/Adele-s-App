import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// Client uses `sheet_date` but the DB column is `date`. Translate both ways.
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data ?? []).map(toClient));
}

export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;

  // Whitelist columns. The previous version spread the full body which
  // included fields the DB doesn't have (e.g., empty service_id strings).
  const dateValue = (body.date ?? body.sheet_date) as string | undefined;

  const payload: Record<string, unknown> = {
    service_name: body.service_name ?? null,
    department: body.department ?? null,
    date: dateValue ?? null,
    status: body.status ?? "pending",
    service_charge: Number(body.service_charge ?? 0),
    non_cash_tips: Number(body.non_cash_tips ?? 0),
  };
  // Foreign keys only if truthy (empty strings break uuid FKs).
  if (body.outlet_id) payload.outlet_id = body.outlet_id;
  if (body.service_id) payload.service_id = body.service_id;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("tip_sheets")
    .insert(payload)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(toClient(data as TipSheetRow));
}

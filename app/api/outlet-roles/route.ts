import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// Supabase column is `position_name`; clients still use `role_name`.
type OutletRole = {
  id: string;
  outlet_id: string;
  position_name?: string | null;
  points?: number | null;
  [key: string]: unknown;
};

function toClient(row: OutletRole) {
  return { ...row, role_name: row.position_name ?? "" };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const outletId = searchParams.get("outlet_id");
  const supabase = createClient();
  let q = supabase.from("outlet_roles").select("*").order("position_name");
  if (outletId) q = q.eq("outlet_id", outletId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data ?? []).map(toClient));
}

export async function POST(req: Request) {
  const body = await req.json();
  const { role_name, position_name, ...rest } = body as {
    role_name?: string;
    position_name?: string;
  } & Record<string, unknown>;

  const payload: Record<string, unknown> = {
    ...rest,
    position_name: position_name ?? role_name ?? "",
  };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("outlet_roles")
    .insert(payload)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(toClient(data as OutletRole));
}

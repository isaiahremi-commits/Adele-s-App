import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// Supabase column is `position_name`; clients may send `role_name` or
// `position_name`. Points column might be `points` or `point_value`.
type OutletRole = {
  id: string;
  outlet_id: string;
  position_name?: string | null;
  points?: number | null;
  point_value?: number | null;
  [key: string]: unknown;
};

function toClient(row: OutletRole) {
  return {
    ...row,
    role_name: row.position_name ?? "",
    points: row.points ?? row.point_value ?? 0,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const outletId = searchParams.get("outlet_id");
  const supabase = createClient();
  let q = supabase.from("outlet_roles").select("*");
  if (outletId) q = q.eq("outlet_id", outletId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []).map(toClient);
  rows.sort((a, b) => (a.role_name ?? "").localeCompare(b.role_name ?? ""));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const position_name = (body.position_name ?? body.role_name ?? "") as string;
  const points = Number(body.points ?? body.point_value ?? 1);
  const outlet_id = body.outlet_id as string | undefined;

  const supabase = createClient();

  // First attempt with `points`.
  let res = await supabase
    .from("outlet_roles")
    .insert({ position_name, points, outlet_id })
    .select()
    .single();

  // Fall back to `point_value` if `points` isn't a column.
  if (res.error && /column .*points/i.test(res.error.message)) {
    res = await supabase
      .from("outlet_roles")
      .insert({ position_name, point_value: points, outlet_id })
      .select()
      .single();
  }

  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
  return NextResponse.json(toClient(res.data as OutletRole));
}

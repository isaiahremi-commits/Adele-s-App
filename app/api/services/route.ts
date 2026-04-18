import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// Table is outlet_services. The service-name column might be `name` or
// `service_name` depending on the schema version — try `name` first and
// fall back on a "column not found" error.

type ServiceRow = {
  id: string;
  name?: string | null;
  service_name?: string | null;
  outlet_id?: string | null;
  [key: string]: unknown;
};

function toClient(row: ServiceRow) {
  return { ...row, name: row.name ?? row.service_name ?? "" };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const outletId = searchParams.get("outlet_id");
  const supabase = createClient();
  let q = supabase.from("outlet_services").select("*");
  if (outletId) q = q.eq("outlet_id", outletId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []).map(toClient);
  rows.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const name = (body.name ?? body.service_name ?? "") as string;
  const outlet_id = body.outlet_id as string | undefined;

  const supabase = createClient();

  // First attempt: use `name`
  let res = await supabase
    .from("outlet_services")
    .insert({ name, outlet_id })
    .select()
    .single();

  // If the column `name` doesn't exist, retry with `service_name`.
  if (res.error && /column .*name/i.test(res.error.message)) {
    res = await supabase
      .from("outlet_services")
      .insert({ service_name: name, outlet_id })
      .select()
      .single();
  }

  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
  return NextResponse.json(toClient(res.data as ServiceRow));
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

type EmployeeRow = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  [key: string]: unknown;
};

function splitName(name: string | undefined | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: "", last_name: "" };
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

function withCombinedName(row: EmployeeRow) {
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return { ...row, name };
}

export async function GET() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("employees")
    .select("*")
    .order("first_name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const mapped = (data ?? []).map(withCombinedName);
  return NextResponse.json(mapped);
}

export async function POST(req: Request) {
  const body = await req.json();
  const supabase = createClient();

  const { name, assignments: _assignments, ...rest } = body as {
    name?: string;
    assignments?: unknown;
  } & Record<string, unknown>;
  void _assignments;
  const payload: Record<string, unknown> = { ...rest };
  if (name !== undefined) {
    const { first_name, last_name } = splitName(name);
    payload.first_name = first_name;
    payload.last_name = last_name;
  }

  const { data, error } = await supabase
    .from("employees")
    .insert(payload)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(withCombinedName(data as EmployeeRow));
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

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

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
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
    .update(payload)
    .eq("id", params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(withCombinedName(data as EmployeeRow));
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  // Read the auth link BEFORE deleting (RLS scopes this to the caller's
  // tenant, so a non-manager gets nothing and deletes nothing).
  const { data: row } = await supabase
    .from("employees")
    .select("auth_user_id")
    .eq("id", params.id)
    .maybeSingle();
  const { error } = await supabase.from("employees").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Best-effort: also remove the login, so delete + re-add with the same
  // email works (Adèle's migration path for test employees). Without the
  // service key this silently skips — Phase 1 behavior.
  if (row?.auth_user_id) {
    const admin = createAdminClient();
    if (admin) await admin.auth.admin.deleteUser(row.auth_user_id).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}

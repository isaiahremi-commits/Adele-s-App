import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireManager } from "@/lib/admin-guard";
import { createAdminClient, ADMIN_NOT_CONFIGURED } from "@/lib/supabase-admin";

// Creates a fully-linked employee in one call:
//   1. auth.users row (Admin API) with a generated temp password,
//      email_confirm: true (no confirmation email — the built-in Supabase
//      SMTP is rate-limited to a couple of emails per hour, which would make
//      "onboard 10 staff in 10 minutes" impossible), and
//      user_metadata { tenant_id, must_change_password: true } so the JWT
//      carries the tenant claim from the first sign-in and the mobile app's
//      ChangePasswordScreen gate fires immediately.
//   2. employees row linked via auth_user_id (inserted with the MANAGER's
//      own client, so RLS + the tenant DEFAULT apply as defense in depth).
//   3. employee_outlets rows for any additional assignments.
// Any later step failing rolls back the earlier ones (delete employees row,
// delete auth user) — no half-linked state survives.
//
// The temp password is returned ONCE for Adèle to hand off; it is never
// stored. The employee signs into the mobile app with it and is forced to
// set their own password before seeing anything.

type Assignment = { outlet_id: string; position_name?: string | null };

type CreateBody = {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string | null;
  department_id?: string | null;
  home_outlet_id?: string | null;
  home_position?: string | null;
  employee_number?: string | null;
  hire_date?: string;
  pay_type?: "hourly" | "salary";
  annual_salary?: number | null;
  regular_rate?: number | null;
  ot_rate?: number | null;
  pto_rate?: number | null;
  training_rate?: number | null;
  // PR #27 item 2: seed balance (hours) applied via pto_adjust_balance.
  pto_starting_balance?: number;
  assignments?: Assignment[];
};

// Unambiguous alphabet (no 0/O/1/l/I) — these get read aloud or retyped
// from a piece of paper.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
function generateTempPassword() {
  const bytes = randomBytes(12);
  let s = "";
  for (let i = 0; i < 12; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function badRate(v: number | null | undefined) {
  return v != null && (typeof v !== "number" || Number.isNaN(v) || v < 0);
}

export async function POST(req: Request) {
  const gate = await requireManager();
  if ("error" in gate) return gate.error;
  const { supabase, tenantId } = gate;

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: ADMIN_NOT_CONFIGURED }, { status: 501 });

  const body = (await req.json().catch(() => ({}))) as CreateBody;

  const first_name = (body.first_name ?? "").trim();
  const last_name = (body.last_name ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  if (!first_name || !last_name) {
    return NextResponse.json({ error: "First and last name are required." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  if (!body.hire_date) {
    return NextResponse.json({ error: "Hire date is required." }, { status: 400 });
  }
  const pay_type = body.pay_type === "salary" ? "salary" : "hourly";
  if (pay_type === "salary" && !(Number(body.annual_salary) > 0)) {
    return NextResponse.json(
      { error: "Annual salary must be greater than 0 for salaried employees." },
      { status: 400 }
    );
  }
  if (pay_type === "hourly" && !(Number(body.regular_rate) > 0)) {
    return NextResponse.json(
      { error: "Hourly rate must be greater than 0." },
      { status: 400 }
    );
  }
  if ([body.ot_rate, body.pto_rate, body.training_rate].some(badRate)) {
    return NextResponse.json({ error: "Rates cannot be negative." }, { status: 400 });
  }

  // Duplicate email = a person who already exists (or a stale test row).
  // Surface it before creating an auth user we'd only have to delete.
  const { data: existing } = await supabase
    .from("employees")
    .select("id, first_name, last_name")
    .ilike("email", email)
    .limit(1);
  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: `An employee with this email already exists (${existing[0].first_name} ${existing[0].last_name}). Remove them first or use a different email.` },
      { status: 409 }
    );
  }

  // 1. Auth user.
  const tempPassword = generateTempPassword();
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { tenant_id: tenantId, must_change_password: true },
  });
  if (authErr || !created?.user) {
    const msg = authErr?.message ?? "Auth user creation failed";
    const dup = /already|exists|registered/i.test(msg);
    return NextResponse.json(
      { error: dup ? "A login with this email already exists in Auth. Delete it in Supabase → Authentication, or use a different email." : msg },
      { status: dup ? 409 : 500 }
    );
  }
  const authUserId = created.user.id;

  // 2. employees row — manager's own client: RLS applies, tenant DEFAULT
  // stamps tenant_id from the manager's JWT.
  const { data: emp, error: empErr } = await supabase
    .from("employees")
    .insert({
      first_name,
      last_name,
      email,
      phone: body.phone || null,
      department_id: body.department_id || null,
      home_outlet_id: body.home_outlet_id || null,
      home_position: body.home_position || null,
      employee_number: body.employee_number || null,
      date_of_hire: body.hire_date,
      pay_type,
      annual_salary: body.annual_salary ?? null,
      regular_rate: body.regular_rate ?? null,
      ot_rate: body.ot_rate ?? null,
      pto_rate: body.pto_rate ?? null,
      training_rate: body.training_rate ?? null,
      auth_user_id: authUserId,
    })
    .select("id")
    .single();
  if (empErr || !emp) {
    await admin.auth.admin.deleteUser(authUserId);
    return NextResponse.json(
      { error: `Employee record failed (${empErr?.message ?? "unknown"}); auth user rolled back.` },
      { status: 500 }
    );
  }

  // 3. Additional outlet assignments (tenant_id auto-stamps post-015;
  // pre-015 the column doesn't exist and the insert works the same).
  const assignments = (body.assignments ?? []).filter((a) => a?.outlet_id);
  if (assignments.length > 0) {
    const { error: eoErr } = await supabase.from("employee_outlets").insert(
      assignments.map((a) => ({
        employee_id: emp.id,
        outlet_id: a.outlet_id,
        position_name: a.position_name || null,
      }))
    );
    if (eoErr) {
      await supabase.from("employees").delete().eq("id", emp.id);
      await admin.auth.admin.deleteUser(authUserId);
      return NextResponse.json(
        { error: `Outlet assignments failed (${eoErr.message}); employee and auth user rolled back.` },
        { status: 500 }
      );
    }
  }

  // 4. PR #27 item 2: starting PTO balance. Best-effort — the account is
  // fully created by now, so a seed failure must not roll it back; the
  // manager can re-apply it from the PTO page's Adjust flow. The ledger has
  // no 'initial' transaction_type anywhere (pto_adjust_balance hardcodes
  // 'adjustment'), so the note carries the intent instead.
  let ptoSeedError: string | null = null;
  const startingBalance = Number(body.pto_starting_balance) || 0;
  if (startingBalance > 0) {
    const { error: ptoErr } = await supabase.rpc("pto_adjust_balance", {
      p_employee_id: emp.id,
      p_delta: startingBalance,
      p_notes: "Starting balance (set at onboarding)",
    });
    if (ptoErr) ptoSeedError = ptoErr.message;
  }

  return NextResponse.json({
    ok: true,
    employee_id: emp.id,
    auth_user_id: authUserId,
    email,
    temp_password: tempPassword,
    ...(ptoSeedError
      ? { warning: `Employee created, but the starting PTO balance could not be applied (${ptoSeedError}). Set it from the PTO page.` }
      : {}),
  });
}

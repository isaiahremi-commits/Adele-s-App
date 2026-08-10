import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireManager } from "@/lib/admin-guard";
import { createAdminClient, ADMIN_NOT_CONFIGURED } from "@/lib/supabase-admin";

// "Invite / Reset password" for one employee. Two cases:
//   - Employee has NO linked login (pre-dates this flow, or Adèle skipped
//     the wizard): create the auth user now, link it, stamp the tenant +
//     must_change_password metadata — the invite path for legacy rows.
//   - Employee already linked: set a fresh temp password and re-arm
//     must_change_password, so the old password stops working and the
//     mobile app forces a new one on next sign-in.
// Either way the response carries a new one-time temp password for Adèle to
// hand off. Deliberately NOT the email magic-link flow: the built-in
// Supabase SMTP allows only a couple of emails per hour (custom SMTP isn't
// configured), and a recovery link would land the employee on the
// manager-facing web app rather than the mobile app they actually use.

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
function generateTempPassword() {
  const bytes = randomBytes(12);
  let s = "";
  for (let i = 0; i < 12; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const gate = await requireManager();
  if ("error" in gate) return gate.error;
  const { supabase, tenantId } = gate;

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: ADMIN_NOT_CONFIGURED }, { status: 501 });

  // Manager's own client: RLS scopes the lookup to their tenant.
  const { data: emp, error: empErr } = await supabase
    .from("employees")
    .select("id, first_name, last_name, email, auth_user_id, termination_date")
    .eq("id", params.id)
    .maybeSingle();
  if (empErr) return NextResponse.json({ error: empErr.message }, { status: 500 });
  if (!emp) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  if (emp.termination_date) {
    return NextResponse.json(
      { error: "Employee is terminated — reactivate them first." },
      { status: 409 }
    );
  }
  const tempPassword = generateTempPassword();

  if (!emp.auth_user_id) {
    // First invite for a legacy row: create + link. Only THIS path needs an
    // email on the employees row — it's what the new login gets created with.
    const email = (emp.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json(
        { error: "This employee isn't linked to a login yet and has no email on file — add an email via Edit, then invite them." },
        { status: 409 }
      );
    }
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
        { error: dup ? "A login with this email already exists in Auth but isn't linked to this employee. Resolve it in Supabase → Authentication." : msg },
        { status: dup ? 409 : 500 }
      );
    }
    const { error: linkErr } = await supabase
      .from("employees")
      .update({ auth_user_id: created.user.id })
      .eq("id", emp.id);
    if (linkErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      return NextResponse.json(
        { error: `Linking failed (${linkErr.message}); auth user rolled back.` },
        { status: 500 }
      );
    }
    return NextResponse.json({
      ok: true,
      linked: true,
      email,
      temp_password: tempPassword,
    });
  }

  // Already linked: the login credential is auth.users.email — NOT
  // employees.email, which is a secondary contact field that may be empty
  // (PR #15 Bug 2: Adèle's own pre-015 row had none and reset failed).
  const { data: authUser, error: getUserErr } = await admin.auth.admin.getUserById(
    emp.auth_user_id
  );
  if (getUserErr || !authUser?.user?.email) {
    return NextResponse.json(
      { error: "Couldn't look up this employee's login — refresh and try again." },
      { status: 500 }
    );
  }

  // Rotate the password + re-arm the change gate. Metadata is merged
  // server-side, so tenant_id survives.
  const { error: updErr } = await admin.auth.admin.updateUserById(emp.auth_user_id, {
    password: tempPassword,
    user_metadata: { tenant_id: tenantId, must_change_password: true },
  });
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    linked: false,
    email: authUser.user.email,
    temp_password: tempPassword,
  });
}

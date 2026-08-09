"use client";
import { useState } from "react";
import Modal from "@/components/Modal";
import { PREDEFINED_ROLES, OTHER_OPTION } from "@/lib/constants";
import { titleCase } from "@/lib/format";

// Four-step onboarding wizard: Basics → Position & outlets → Pay rates →
// Review & invite. Submits to /api/admin/employees/create, which creates
// the auth login + linked employees row + outlet assignments atomically,
// then shows the one-time temp password for Adèle to hand off. The employee
// signs into the mobile app with it and is forced to set their own password
// (user_metadata.must_change_password) before anything else.

type Outlet = { id: string; name: string };
type Department = { id: string; name: string };
type Role = { id: string; role_name: string; outlet_id: string };
type Assignment = { outlet_id: string; position_name: string };

type WizardForm = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  hire_date: string;
  department_id: string;
  home_outlet_id: string;
  home_position: string;
  employee_number: string;
  pay_type: "hourly" | "salary";
  annual_salary: string;
  regular_rate: string;
  ot_rate: string;
  pto_rate: string;
  training_rate: string;
  assignments: Assignment[];
};

function localToday() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function emptyWizardForm(): WizardForm {
  return {
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    hire_date: localToday(),
    department_id: "",
    home_outlet_id: "",
    home_position: "",
    employee_number: "",
    pay_type: "hourly",
    annual_salary: "",
    regular_rate: "",
    ot_rate: "",
    pto_rate: "",
    training_rate: "",
    assignments: [],
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STEPS = ["Basics", "Position & outlets", "Pay rates", "Review & invite"];

export default function AddEmployeeWizard({
  open,
  onClose,
  outlets,
  departments,
  roles,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  outlets: Outlet[];
  departments: Department[];
  roles: Role[];
  onCreated: () => void;
}) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<WizardForm>(emptyWizardForm);
  const [posOther, setPosOther] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ email: string; temp_password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function rolesForOutlet(outletId: string) {
    return roles.filter((r) => r.outlet_id === outletId);
  }
  const homeRoles = form.home_outlet_id ? rolesForOutlet(form.home_outlet_id) : [];
  const homePosOptions: string[] =
    form.home_outlet_id && homeRoles.length > 0
      ? Array.from(new Map(homeRoles.map((r) => [r.role_name.toLowerCase(), r.role_name])).values())
      : [...PREDEFINED_ROLES];

  function reset() {
    setStep(0);
    setForm(emptyWizardForm());
    setPosOther(false);
    setError(null);
    setResult(null);
    setCopied(false);
  }

  function close() {
    reset();
    onClose();
  }

  function validateStep(s: number): string | null {
    if (s === 0) {
      if (!form.first_name.trim() || !form.last_name.trim())
        return "First and last name are required.";
      if (!EMAIL_RE.test(form.email.trim()))
        return "A valid email is required — it becomes their login.";
      if (!form.hire_date) return "Hire date is required (PTO accrual needs it).";
    }
    if (s === 2) {
      if (form.pay_type === "hourly" && !(Number(form.regular_rate) > 0))
        return "Hourly rate must be greater than 0.";
      if (form.pay_type === "salary" && !(Number(form.annual_salary) > 0))
        return "Annual salary must be greater than 0.";
      for (const [label, v] of [
        ["OT rate", form.ot_rate],
        ["PTO rate", form.pto_rate],
        ["Training rate", form.training_rate],
      ] as const) {
        if (v !== "" && Number(v) < 0) return `${label} cannot be negative.`;
      }
    }
    return null;
  }

  function next() {
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStep((v) => Math.min(v + 1, STEPS.length - 1));
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/employees/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone || null,
          hire_date: form.hire_date,
          department_id: form.department_id || null,
          home_outlet_id: form.home_outlet_id || null,
          home_position: form.home_position || null,
          employee_number: form.employee_number || null,
          pay_type: form.pay_type,
          annual_salary: form.annual_salary === "" ? null : Number(form.annual_salary),
          regular_rate: form.regular_rate === "" ? null : Number(form.regular_rate),
          ot_rate: form.ot_rate === "" ? null : Number(form.ot_rate),
          pto_rate: form.pto_rate === "" ? null : Number(form.pto_rate),
          training_rate: form.training_rate === "" ? null : Number(form.training_rate),
          assignments: form.assignments.filter((a) => a.outlet_id),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`);
        return;
      }
      setResult({ email: data.email, temp_password: data.temp_password });
      onCreated(); // refresh the list behind the modal
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyPassword() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.temp_password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the password is visible to copy by hand */
    }
  }

  const deptName = departments.find((d) => d.id === form.department_id)?.name;
  const outletName = outlets.find((o) => o.id === form.home_outlet_id)?.name;

  return (
    <Modal open={open} onClose={close} title={result ? "Employee added" : "Add Employee"}>
      {result ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            <strong>{form.first_name} {form.last_name}</strong> can now sign in to the app with:
          </p>
          <div className="rounded-md p-3" style={{ background: "var(--surface-2)" }}>
            <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>Email</div>
            <div className="text-sm font-semibold mb-3">{result.email}</div>
            <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>Temporary password</div>
            <div className="flex items-center gap-2">
              <code className="text-lg font-semibold tracking-wider" style={{ color: "var(--primary)" }}>
                {result.temp_password}
              </code>
              <button className="btn btn-secondary text-xs" onClick={copyPassword}>
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Hand this off in person or by text. It is shown only once and never stored.
            On first sign-in the app forces them to set their own password.
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={reset}>Add another</button>
            <button className="btn btn-primary" onClick={close}>Done</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Step indicator */}
          <div className="flex items-center gap-1 mb-1">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-1 flex-1">
                <div
                  className="text-xs px-2 py-1 rounded-md text-center flex-1"
                  style={{
                    background: i === step ? "var(--surface-2)" : "transparent",
                    color: i === step ? "var(--primary)" : i < step ? "var(--foreground)" : "var(--muted)",
                    fontWeight: i === step ? 600 : 400,
                  }}
                >
                  {i < step ? "✓ " : ""}{s}
                </div>
              </div>
            ))}
          </div>

          {step === 0 && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm">First name <span style={{ color: "var(--danger)" }}>*</span>
                  <input className="input mt-1" value={form.first_name}
                    onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
                </label>
                <label className="text-sm">Last name <span style={{ color: "var(--danger)" }}>*</span>
                  <input className="input mt-1" value={form.last_name}
                    onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
                </label>
              </div>
              <label className="text-sm">Email <span style={{ color: "var(--danger)" }}>*</span>
                <input type="email" className="input mt-1" placeholder="Becomes their app login"
                  value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm">Phone
                  <input className="input mt-1" value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </label>
                <label className="text-sm">Hire date <span style={{ color: "var(--danger)" }}>*</span>
                  <input type="date" className="input mt-1" value={form.hire_date}
                    onChange={(e) => setForm({ ...form, hire_date: e.target.value })} />
                </label>
              </div>
              <label className="text-sm">Department
                <select className="input mt-1" value={form.department_id}
                  onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                  <option value="">Select…</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
            </>
          )}

          {step === 1 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">Home Outlet
                  <select className="input mt-1" value={form.home_outlet_id}
                    onChange={(e) => setForm({ ...form, home_outlet_id: e.target.value, home_position: "" })}>
                    <option value="">Select…</option>
                    {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </label>
                <label className="text-sm">Home Position
                  <select className="input mt-1" value={posOther ? OTHER_OPTION : form.home_position}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === OTHER_OPTION) { setPosOther(true); setForm({ ...form, home_position: "" }); }
                      else { setPosOther(false); setForm({ ...form, home_position: v }); }
                    }}>
                    <option value="">{form.home_outlet_id ? "Select…" : "Pick home outlet first"}</option>
                    {homePosOptions.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
                    <option value={OTHER_OPTION}>{OTHER_OPTION}</option>
                  </select>
                  {posOther && (
                    <input className="input mt-1" placeholder="Custom position"
                      value={form.home_position}
                      onChange={(e) => setForm({ ...form, home_position: e.target.value })} />
                  )}
                </label>
              </div>
              <label className="text-sm">Employee ID Number
                <input className="input mt-1" value={form.employee_number}
                  onChange={(e) => setForm({ ...form, employee_number: e.target.value })} />
              </label>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium">Additional Outlets & Positions</div>
                  <button type="button" className="btn btn-secondary text-xs"
                    onClick={() => setForm((f) => ({ ...f, assignments: [...f.assignments, { outlet_id: "", position_name: "" }] }))}>
                    + Add
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {form.assignments.length === 0 && (
                    <div className="text-xs" style={{ color: "var(--muted)" }}>
                      None — employee only works at their home outlet.
                    </div>
                  )}
                  {form.assignments.map((a, i) => {
                    const aRoles = a.outlet_id ? rolesForOutlet(a.outlet_id) : [];
                    return (
                      <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                        <select className="input" value={a.outlet_id}
                          onChange={(e) => setForm((f) => {
                            const next = [...f.assignments];
                            next[i] = { outlet_id: e.target.value, position_name: "" };
                            return { ...f, assignments: next };
                          })}>
                          <option value="">Outlet…</option>
                          {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                        <select className="input" value={a.position_name} disabled={!a.outlet_id}
                          onChange={(e) => setForm((f) => {
                            const next = [...f.assignments];
                            next[i] = { ...next[i], position_name: e.target.value };
                            return { ...f, assignments: next };
                          })}>
                          <option value="">Position…</option>
                          {aRoles.map((r) => <option key={r.id} value={r.role_name}>{titleCase(r.role_name)}</option>)}
                        </select>
                        <button type="button" className="btn btn-secondary" style={{ color: "var(--danger)" }}
                          onClick={() => setForm((f) => ({ ...f, assignments: f.assignments.filter((_, idx) => idx !== i) }))}>
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <div className="text-sm font-medium mb-1">Pay Type</div>
                <div className="inline-flex rounded-lg p-1" style={{ background: "var(--surface-2)" }}>
                  {(["hourly", "salary"] as const).map((pt) => (
                    <button key={pt} type="button" onClick={() => setForm({ ...form, pay_type: pt })}
                      className="text-xs px-4 py-1 rounded-md"
                      style={{
                        background: form.pay_type === pt ? "var(--surface)" : "transparent",
                        color: form.pay_type === pt ? "var(--primary)" : "var(--muted)",
                        fontWeight: form.pay_type === pt ? 600 : 400, border: "none", cursor: "pointer",
                      }}>
                      {pt === "hourly" ? "Hourly" : "Salary"}
                    </button>
                  ))}
                </div>
              </div>
              {form.pay_type === "hourly" ? (
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">Hourly rate ($) <span style={{ color: "var(--danger)" }}>*</span>
                    <input type="number" step="0.01" min="0" className="input mt-1" value={form.regular_rate}
                      onChange={(e) => setForm({ ...form, regular_rate: e.target.value })} />
                  </label>
                  <label className="text-sm">OT rate ($)
                    <input type="number" step="0.01" min="0" className="input mt-1" value={form.ot_rate}
                      onChange={(e) => setForm({ ...form, ot_rate: e.target.value })} />
                  </label>
                  <label className="text-sm">PTO rate ($)
                    <input type="number" step="0.01" min="0" className="input mt-1" value={form.pto_rate}
                      onChange={(e) => setForm({ ...form, pto_rate: e.target.value })} />
                  </label>
                  <label className="text-sm">Training rate ($)
                    <input type="number" step="0.01" min="0" className="input mt-1" value={form.training_rate}
                      onChange={(e) => setForm({ ...form, training_rate: e.target.value })} />
                  </label>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">Annual salary ($) <span style={{ color: "var(--danger)" }}>*</span>
                    <input type="number" step="0.01" min="0" className="input mt-1" value={form.annual_salary}
                      onChange={(e) => setForm({ ...form, annual_salary: e.target.value })} />
                  </label>
                  <label className="text-sm">PTO rate ($)
                    <input type="number" step="0.01" min="0" className="input mt-1" value={form.pto_rate}
                      onChange={(e) => setForm({ ...form, pto_rate: e.target.value })} />
                  </label>
                  <p className="text-xs col-span-2" style={{ color: "var(--muted)" }}>
                    Hourly &amp; OT rates don&rsquo;t apply to salaried employees.
                  </p>
                </div>
              )}
            </>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-2 text-sm">
              {([
                ["Name", `${form.first_name} ${form.last_name}`.trim()],
                ["Email (login)", form.email.trim().toLowerCase()],
                ["Phone", form.phone || "—"],
                ["Hire date", form.hire_date],
                ["Department", deptName ?? "—"],
                ["Home outlet", outletName ?? "—"],
                ["Position", form.home_position ? titleCase(form.home_position) : "—"],
                ["Also works at", form.assignments.filter((a) => a.outlet_id).map((a) => {
                  const o = outlets.find((x) => x.id === a.outlet_id)?.name ?? "?";
                  return a.position_name ? `${o} (${titleCase(a.position_name)})` : o;
                }).join(", ") || "—"],
                ["Pay", form.pay_type === "salary"
                  ? `Salary $${form.annual_salary}/yr`
                  : `$${form.regular_rate}/hr` +
                    (form.ot_rate ? `, OT $${form.ot_rate}` : "") +
                    (form.pto_rate ? `, PTO $${form.pto_rate}` : "") +
                    (form.training_rate ? `, Training $${form.training_rate}` : "")],
              ] as const).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <span style={{ color: "var(--muted)" }}>{k}</span>
                  <span className="text-right">{v}</span>
                </div>
              ))}
              <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>
                Creating generates a one-time temporary password to hand off.
                The employee is forced to set their own on first sign-in.
              </p>
            </div>
          )}

          {error && (
            <div className="text-sm p-2 rounded-md" style={{ background: "rgba(239,90,90,0.15)", color: "var(--danger)" }}>
              {error}
            </div>
          )}

          <div className="flex justify-between gap-2 mt-2">
            <button type="button" className="btn btn-secondary" disabled={submitting}
              onClick={() => (step === 0 ? close() : (setError(null), setStep(step - 1)))}>
              {step === 0 ? "Cancel" : "Back"}
            </button>
            {step < STEPS.length - 1 ? (
              <button type="button" className="btn btn-primary" onClick={next}>Next</button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={submitting} onClick={submit}>
                {submitting ? "Creating…" : "Create & generate password"}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

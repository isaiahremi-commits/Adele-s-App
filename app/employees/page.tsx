"use client";
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";

type Employee = {
  id: string;
  name: string;
  department?: string;
  position?: string;
  phone?: string;
  email?: string;
  active?: boolean;
  department_id?: string | null;
  home_outlet_id?: string | null;
  home_position?: string | null;
  sms_opt_in?: boolean;
  sms_opt_in_pending?: boolean;
  sms_opted_in_at?: string | null;
};

type Outlet = { id: string; name: string };
type Department = { id: string; name: string };
type Totals = { total_tips: number; total_sc: number; total_nc: number };
type ViewMode = "grid" | "list";
type Role = { id: string; role_name: string; outlet_id: string };
type Assignment = { outlet_id: string; position_name: string };

type Form = {
  name: string;
  department_id: string;
  home_outlet_id: string;
  home_position: string;
  phone: string;
  email: string;
  assignments: Assignment[];
};

const emptyForm: Form = {
  name: "",
  department_id: "",
  home_outlet_id: "",
  home_position: "",
  phone: "",
  email: "",
  assignments: [],
};

export default function EmployeesPage() {
  const [rows, setRows] = useState<Employee[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [smsBusy, setSmsBusy] = useState(false);
  const [smsMsg, setSmsMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [totals, setTotals] = useState<Record<string, Totals>>({});
  const [assignmentsByEmp, setAssignmentsByEmp] = useState<Record<string, Assignment[]>>({});

  async function load() {
    const [r, o, d, rl, t, a] = await Promise.all([
      fetch("/api/employees").then((r) => r.json()),
      fetch("/api/outlets").then((r) => r.json()),
      fetch("/api/departments").then((r) => r.json()),
      fetch("/api/outlet-roles").then((r) => r.json()),
      fetch("/api/employees/totals").then((r) => r.json()).catch(() => ({})),
      fetch("/api/employee-outlets").then((r) => r.json()).catch(() => []),
    ]);
    setRows(Array.isArray(r) ? r : []);
    setOutlets(Array.isArray(o) ? o : []);
    setDepartments(Array.isArray(d) ? d : []);
    setRoles(Array.isArray(rl) ? rl : []);
    setTotals(typeof t === "object" && t !== null && !Array.isArray(t) ? t : {});
    const byEmp: Record<string, Assignment[]> = {};
    if (Array.isArray(a)) {
      for (const row of a) {
        const empId = row.employee_id as string;
        if (!empId) continue;
        if (!byEmp[empId]) byEmp[empId] = [];
        byEmp[empId].push({ outlet_id: row.outlet_id, position_name: row.position_name ?? "" });
      }
    }
    setAssignmentsByEmp(byEmp);
  }
  useEffect(() => { load(); }, []);

  function rolesForOutlet(outletId: string) {
    return roles.filter((r) => r.outlet_id === outletId);
  }

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setSmsMsg(null);
    setOpen(true);
  }

  async function openEdit(e: Employee) {
    setEditing(e);
    setError(null);
    setSmsMsg(null);
    // Fetch existing additional-outlet assignments.
    let assignments: Assignment[] = [];
    try {
      const res = await fetch(`/api/employee-outlets?employee_id=${e.id}`).then((r) => r.json());
      if (Array.isArray(res)) {
        assignments = res.map((a: { outlet_id: string; position_name: string | null }) => ({
          outlet_id: a.outlet_id,
          position_name: a.position_name ?? "",
        }));
      }
    } catch {}
    setForm({
      name: e.name ?? "",
      department_id: e.department_id ?? "",
      home_outlet_id: e.home_outlet_id ?? "",
      home_position: e.home_position ?? "",
      phone: e.phone ?? "",
      email: e.email ?? "",
      assignments,
    });
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name: form.name,
        department_id: form.department_id || null,
        home_outlet_id: form.home_outlet_id || null,
        home_position: form.home_position || null,
        phone: form.phone || null,
        email: form.email || null,
      };
      const url = editing ? `/api/employees/${editing.id}` : "/api/employees";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`);
        return;
      }
      const employeeId = data.id ?? editing?.id;

      // Replace the employee_outlets junction rows.
      if (employeeId) {
        await fetch("/api/employee-outlets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            replace: true,
            employee_id: employeeId,
            assignments: form.assignments.filter((a) => a.outlet_id),
          }),
        });
      }

      setOpen(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function sendOptInInvite() {
    if (!editing) return;
    setSmsBusy(true);
    setSmsMsg(null);
    try {
      const res = await fetch("/api/sms/opt-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id: editing.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSmsMsg({ kind: "err", text: data.error || "Could not send invite" });
        return;
      }
      setSmsMsg({ kind: "ok", text: "Invite sent. They need to reply YES." });
      setEditing({ ...editing, sms_opt_in_pending: true });
    } catch (err) {
      setSmsMsg({ kind: "err", text: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSmsBusy(false);
    }
  }

  async function revokeOptIn() {
    if (!editing) return;
    if (!confirm("Revoke SMS consent for this employee? They will stop receiving texts immediately.")) return;
    setSmsBusy(true);
    setSmsMsg(null);
    try {
      const res = await fetch(`/api/employees/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sms_opt_in: false, sms_opt_in_pending: false, sms_opted_in_at: null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSmsMsg({ kind: "err", text: data.error || "Could not revoke" });
        return;
      }
      setSmsMsg({ kind: "ok", text: "SMS consent revoked." });
      setEditing({ ...editing, sms_opt_in: false, sms_opt_in_pending: false, sms_opted_in_at: null });
    } catch (err) {
      setSmsMsg({ kind: "err", text: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSmsBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this employee?")) return;
    await fetch(`/api/employees/${id}`, { method: "DELETE" });
    load();
  }

  function updateAssignment(i: number, patch: Partial<Assignment>) {
    setForm((f) => {
      const next = [...f.assignments];
      next[i] = { ...next[i], ...patch };
      // Reset position when outlet changes.
      if (patch.outlet_id !== undefined) next[i].position_name = "";
      return { ...f, assignments: next };
    });
  }

  function addAssignment() {
    setForm((f) => ({ ...f, assignments: [...f.assignments, { outlet_id: "", position_name: "" }] }));
  }

  function removeAssignment(i: number) {
    setForm((f) => ({ ...f, assignments: f.assignments.filter((_, idx) => idx !== i) }));
  }

  const homeRoles = form.home_outlet_id ? rolesForOutlet(form.home_outlet_id) : [];

  return (
    <div>
      <header className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold">Employees</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>{rows.length} total</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Employee</button>
      </header>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="Search employees..."
          className="input"
          style={{ maxWidth: 320, flex: 1 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-1 rounded-lg p-1" style={{ background: "var(--surface-2)" }}>
          <button
            className="text-xs px-3 py-1 rounded-md"
            onClick={() => setViewMode("grid")}
            style={{
              background: viewMode === "grid" ? "var(--surface)" : "transparent",
              color: viewMode === "grid" ? "var(--primary)" : "var(--muted)",
              fontWeight: viewMode === "grid" ? 600 : 400,
            }}
          >
            Grid
          </button>
          <button
            className="text-xs px-3 py-1 rounded-md"
            onClick={() => setViewMode("list")}
            style={{
              background: viewMode === "list" ? "var(--surface)" : "transparent",
              color: viewMode === "list" ? "var(--primary)" : "var(--muted)",
              fontWeight: viewMode === "list" ? 600 : 400,
            }}
          >
            List
          </button>
        </div>
      </div>

      {(() => {
        const filtered = rows.filter((e) => {
          if (!search.trim()) return true;
          const q = search.toLowerCase();
          const dept = departments.find((d) => d.id === e.department_id)?.name ?? e.department ?? "";
          const homeOutlet = outlets.find((o) => o.id === e.home_outlet_id)?.name ?? "";
          return (
            (e.name ?? "").toLowerCase().includes(q) ||
            (e.home_position ?? e.position ?? "").toLowerCase().includes(q) ||
            dept.toLowerCase().includes(q) ||
            homeOutlet.toLowerCase().includes(q) ||
            (e.email ?? "").toLowerCase().includes(q) ||
            (e.phone ?? "").toLowerCase().includes(q)
          );
        });

        if (filtered.length === 0) {
          return <div className="card p-6 text-center" style={{ color: "var(--muted)" }}>
            {rows.length === 0 ? "No employees yet." : "No employees match your search."}
          </div>;
        }

        return (
          <div className={viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" : "flex flex-col gap-2"}>
            {filtered.map((e) => {
              const dept = departments.find((d) => d.id === e.department_id)?.name ?? e.department;
              const homeOutlet = outlets.find((o) => o.id === e.home_outlet_id)?.name;
              const isExpanded = expandedId === e.id;
              const empTotals = totals[e.id] ?? { total_tips: 0, total_sc: 0, total_nc: 0 };
              const extraAssignments = assignmentsByEmp[e.id] ?? [];

              return (
                <div
                  key={e.id}
                  className="card p-5 cursor-pointer transition-all"
                  onClick={() => setExpandedId(isExpanded ? null : e.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center font-semibold shrink-0" style={{ background: "var(--surface-2)", color: "var(--primary)" }}>
                        {e.name?.[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold truncate">{e.name}</h3>
                        <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                          {e.home_position || e.position || "-"}{dept && ` · ${dept}`}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
                      {homeOutlet && (
                        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
                          Home outlet: <span style={{ color: "var(--foreground)" }}>{homeOutlet}</span>
                        </div>
                      )}
                      {extraAssignments.length > 0 && (
                        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
                          Also works at: {extraAssignments.map((a, i) => {
                            const oName = outlets.find((o) => o.id === a.outlet_id)?.name ?? "?";
                            return <span key={i} style={{ color: "var(--foreground)" }}>{oName}{a.position_name && ` (${a.position_name})`}{i < extraAssignments.length - 1 ? ", " : ""}</span>;
                          })}
                        </div>
                      )}
                      <div className="text-sm mb-3" style={{ color: "var(--muted)" }}>
                        {e.phone && <div>{e.phone}</div>}
                        {e.email && <div>{e.email}</div>}
                      </div>

                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="rounded-md p-2" style={{ background: "var(--surface-2)" }}>
                          <div className="text-xs" style={{ color: "var(--muted)" }}>Total tips</div>
                          <div className="font-semibold text-sm" style={{ color: "var(--primary)" }}>${empTotals.total_tips.toFixed(2)}</div>
                        </div>
                        <div className="rounded-md p-2" style={{ background: "var(--surface-2)" }}>
                          <div className="text-xs" style={{ color: "var(--muted)" }}>Service charge</div>
                          <div className="font-semibold text-sm">${empTotals.total_sc.toFixed(2)}</div>
                        </div>
                        <div className="rounded-md p-2" style={{ background: "var(--surface-2)" }}>
                          <div className="text-xs" style={{ color: "var(--muted)" }}>Non-cash tips</div>
                          <div className="font-semibold text-sm">${empTotals.total_nc.toFixed(2)}</div>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button className="btn btn-secondary text-xs" onClick={(ev) => { ev.stopPropagation(); openEdit(e); }}>Edit</button>
                        <button className="btn btn-secondary text-xs" onClick={(ev) => { ev.stopPropagation(); remove(e.id); }} style={{ color: "var(--danger)" }}>Remove</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit Employee" : "Add Employee"}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="text-sm">Name
            <input className="input mt-1" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>

          <label className="text-sm">Department
            <select
              className="input mt-1"
              value={form.department_id}
              onChange={(e) => setForm({ ...form, department_id: e.target.value })}
            >
              <option value="">Select…</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Home Outlet
              <select
                className="input mt-1"
                value={form.home_outlet_id}
                onChange={(e) => setForm({ ...form, home_outlet_id: e.target.value, home_position: "" })}
              >
                <option value="">Select…</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">Home Position
              <select
                className="input mt-1"
                value={form.home_position}
                onChange={(e) => setForm({ ...form, home_position: e.target.value })}
                disabled={!form.home_outlet_id}
              >
                <option value="">{form.home_outlet_id ? "Select…" : "Pick outlet first"}</option>
                {homeRoles.map((r) => (
                  <option key={r.id} value={r.role_name}>{r.role_name}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="text-sm">Phone
            <input className="input mt-1" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label className="text-sm">Email
            <input type="email" className="input mt-1" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>

          {editing && (
            <div className="mt-2 p-3 rounded-md" style={{ background: "var(--surface-2)" }}>
              <div className="text-sm font-medium mb-2">SMS Notifications</div>
              {editing.sms_opt_in ? (
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="chip chip-green" style={{ fontSize: 11 }}>Opted in</span>
                    {editing.sms_opted_in_at && (
                      <span className="text-xs ml-2" style={{ color: "var(--muted)" }}>
                        on {new Date(editing.sms_opted_in_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <button type="button" className="btn btn-secondary text-xs" onClick={revokeOptIn} disabled={smsBusy} style={{ color: "var(--danger)" }}>
                    {smsBusy ? "Working..." : "Revoke consent"}
                  </button>
                </div>
              ) : editing.sms_opt_in_pending ? (
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="chip chip-amber" style={{ fontSize: 11 }}>Pending — waiting for YES reply</span>
                  </div>
                  <button type="button" className="btn btn-secondary text-xs" onClick={sendOptInInvite} disabled={smsBusy || !editing.phone}>
                    {smsBusy ? "Sending..." : "Resend invite"}
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-xs mb-2" style={{ color: "var(--muted)" }}>
                    {editing.phone
                      ? "Send a one-time text asking them to reply YES to receive schedule and tip notifications."
                      : "Add a phone number above to enable SMS opt-in."}
                  </p>
                  <button type="button" className="btn btn-secondary text-xs" onClick={sendOptInInvite} disabled={smsBusy || !editing.phone}>
                    {smsBusy ? "Sending..." : "Send opt-in invite via SMS"}
                  </button>
                </div>
              )}
              {smsMsg && (
                <div className="text-xs mt-2" style={{ color: smsMsg.kind === "ok" ? "var(--primary)" : "var(--danger)" }}>
                  {smsMsg.text}
                </div>
              )}
            </div>
          )}

          <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">Additional Outlets & Positions</div>
              <button type="button" className="btn btn-secondary text-xs" onClick={addAssignment}>+ Add</button>
            </div>
            <div className="flex flex-col gap-2">
              {form.assignments.length === 0 && (
                <div className="text-xs" style={{ color: "var(--muted)" }}>None — employee only works at home outlet.</div>
              )}
              {form.assignments.map((a, i) => {
                const aRoles = a.outlet_id ? rolesForOutlet(a.outlet_id) : [];
                return (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <select
                      className="input"
                      value={a.outlet_id}
                      onChange={(e) => updateAssignment(i, { outlet_id: e.target.value })}
                    >
                      <option value="">Outlet…</option>
                      {outlets.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                    <select
                      className="input"
                      value={a.position_name}
                      onChange={(e) => updateAssignment(i, { position_name: e.target.value })}
                      disabled={!a.outlet_id}
                    >
                      <option value="">Position…</option>
                      {aRoles.map((r) => (
                        <option key={r.id} value={r.role_name}>{r.role_name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeAssignment(i)}
                      className="btn btn-secondary"
                      style={{ color: "var(--danger)" }}
                    >×</button>
                  </div>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="text-sm p-2 rounded-md" style={{ background: "rgba(239,90,90,0.15)", color: "var(--danger)" }}>
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "Saving…" : editing ? "Save" : "Add"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

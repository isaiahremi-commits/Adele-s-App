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
};

type Outlet = { id: string; name: string };
type Department = { id: string; name: string };
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

  async function load() {
    const [r, o, d, rl] = await Promise.all([
      fetch("/api/employees").then((r) => r.json()),
      fetch("/api/outlets").then((r) => r.json()),
      fetch("/api/departments").then((r) => r.json()),
      fetch("/api/outlet-roles").then((r) => r.json()),
    ]);
    setRows(Array.isArray(r) ? r : []);
    setOutlets(Array.isArray(o) ? o : []);
    setDepartments(Array.isArray(d) ? d : []);
    setRoles(Array.isArray(rl) ? rl : []);
  }
  useEffect(() => { load(); }, []);

  function rolesForOutlet(outletId: string) {
    return roles.filter((r) => r.outlet_id === outletId);
  }

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setOpen(true);
  }

  async function openEdit(e: Employee) {
    setEditing(e);
    setError(null);
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.length === 0 && <div className="card p-6" style={{ color: "var(--muted)" }}>No employees yet.</div>}
        {rows.map((e) => {
          const dept = departments.find((d) => d.id === e.department_id)?.name ?? e.department;
          const homeOutlet = outlets.find((o) => o.id === e.home_outlet_id)?.name;
          return (
            <div key={e.id} className="card p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold">{e.name}</h3>
                  <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                    {e.home_position || e.position || "—"}{dept && ` · ${dept}`}
                  </div>
                  {homeOutlet && (
                    <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                      Home: {homeOutlet}
                    </div>
                  )}
                </div>
                <div className="w-9 h-9 rounded-full flex items-center justify-center font-semibold" style={{ background: "var(--surface-2)", color: "var(--primary)" }}>
                  {e.name?.[0]?.toUpperCase()}
                </div>
              </div>
              <div className="text-sm space-y-1" style={{ color: "var(--muted)" }}>
                {e.phone && <div>📞 {e.phone}</div>}
                {e.email && <div>✉ {e.email}</div>}
              </div>
              <div className="flex gap-2 mt-4">
                <button className="btn btn-secondary text-xs" onClick={() => openEdit(e)}>Edit</button>
                <button className="btn btn-secondary text-xs" onClick={() => remove(e.id)} style={{ color: "var(--danger)" }}>Remove</button>
              </div>
            </div>
          );
        })}
      </div>

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

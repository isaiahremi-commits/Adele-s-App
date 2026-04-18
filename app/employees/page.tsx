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
};

export default function EmployeesPage() {
  const [rows, setRows] = useState<Employee[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<Partial<Employee>>({ name: "", department: "", position: "", phone: "", email: "" });

  async function load() {
    const r = await fetch("/api/employees").then((r) => r.json());
    setRows(Array.isArray(r) ? r : []);
  }
  useEffect(() => { load(); }, []);

  function openAdd() {
    setEditing(null);
    setForm({ name: "", department: "", position: "", phone: "", email: "" });
    setOpen(true);
  }
  function openEdit(e: Employee) {
    setEditing(e);
    setForm(e);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const url = editing ? `/api/employees/${editing.id}` : "/api/employees";
    const method = editing ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) { setOpen(false); load(); }
  }

  async function remove(id: string) {
    if (!confirm("Remove this employee?")) return;
    await fetch(`/api/employees/${id}`, { method: "DELETE" });
    load();
  }

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
        {rows.map((e) => (
          <div key={e.id} className="card p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold">{e.name}</h3>
                <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                  {e.position || "—"}{e.department && ` · ${e.department}`}
                </div>
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
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit Employee" : "Add Employee"}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="text-sm">Name
            <input className="input mt-1" required value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Department
              <input className="input mt-1" value={form.department ?? ""} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </label>
            <label className="text-sm">Position
              <input className="input mt-1" value={form.position ?? ""} onChange={(e) => setForm({ ...form, position: e.target.value })} />
            </label>
          </div>
          <label className="text-sm">Phone
            <input className="input mt-1" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label className="text-sm">Email
            <input type="email" className="input mt-1" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">{editing ? "Save" : "Add"}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

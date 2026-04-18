"use client";
import { useEffect, useState } from "react";

type Outlet = { id: string; name: string };
type Service = { id: string; name: string; outlet_id: string };
type Role = { id: string; role_name: string; points: number; outlet_id: string };
type PayrollPeriod = { id: string; name?: string; start_date: string; end_date: string; pay_date?: string; active?: boolean };

export default function SetupPage() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);

  const [newOutlet, setNewOutlet] = useState("");
  const [svcForm, setSvcForm] = useState<Record<string, string>>({});
  const [roleForm, setRoleForm] = useState<Record<string, { role_name: string; points: string }>>({});
  const [periodForm, setPeriodForm] = useState({ name: "", start_date: "", end_date: "", pay_date: "" });

  async function load() {
    const [o, s, r, p] = await Promise.all([
      fetch("/api/outlets").then((r) => r.json()),
      fetch("/api/services").then((r) => r.json()),
      fetch("/api/outlet-roles").then((r) => r.json()),
      fetch("/api/payroll-periods").then((r) => r.json()),
    ]);
    setOutlets(Array.isArray(o) ? o : []);
    setServices(Array.isArray(s) ? s : []);
    setRoles(Array.isArray(r) ? r : []);
    setPeriods(Array.isArray(p) ? p : []);
  }
  useEffect(() => { load(); }, []);

  async function addOutlet(e: React.FormEvent) {
    e.preventDefault();
    if (!newOutlet.trim()) return;
    await fetch("/api/outlets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newOutlet }) });
    setNewOutlet("");
    load();
  }

  async function removeOutlet(id: string) {
    if (!confirm("Remove outlet and all its services/roles?")) return;
    await fetch(`/api/outlets/${id}`, { method: "DELETE" });
    load();
  }

  async function addService(outletId: string) {
    const name = svcForm[outletId]?.trim();
    if (!name) return;
    await fetch("/api/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, outlet_id: outletId }) });
    setSvcForm({ ...svcForm, [outletId]: "" });
    load();
  }

  async function removeService(id: string) {
    await fetch(`/api/services/${id}`, { method: "DELETE" });
    load();
  }

  async function addRole(outletId: string) {
    const f = roleForm[outletId];
    if (!f?.role_name.trim()) return;
    await fetch("/api/outlet-roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role_name: f.role_name, points: Number(f.points) || 1, outlet_id: outletId }),
    });
    setRoleForm({ ...roleForm, [outletId]: { role_name: "", points: "1" } });
    load();
  }

  async function removeRole(id: string) {
    await fetch(`/api/outlet-roles/${id}`, { method: "DELETE" });
    load();
  }

  async function addPeriod(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/payroll-periods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(periodForm),
    });
    setPeriodForm({ name: "", start_date: "", end_date: "", pay_date: "" });
    load();
  }

  async function removePeriod(id: string) {
    await fetch(`/api/payroll-periods/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Setup</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>Payroll periods & outlet management</p>
      </header>

      <section className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-3">Payroll Periods</h2>
        <form onSubmit={addPeriod} className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-4">
          <input className="input" placeholder="Name (e.g. W1 Jan)" value={periodForm.name} onChange={(e) => setPeriodForm({ ...periodForm, name: e.target.value })} />
          <input type="date" className="input" required value={periodForm.start_date} onChange={(e) => setPeriodForm({ ...periodForm, start_date: e.target.value })} />
          <input type="date" className="input" required value={periodForm.end_date} onChange={(e) => setPeriodForm({ ...periodForm, end_date: e.target.value })} />
          <input type="date" className="input" placeholder="Pay date" value={periodForm.pay_date} onChange={(e) => setPeriodForm({ ...periodForm, pay_date: e.target.value })} />
          <button className="btn btn-primary" type="submit">+ Add Period</button>
        </form>
        <div className="flex flex-col gap-2">
          {periods.length === 0 && <div className="text-sm" style={{ color: "var(--muted)" }}>No payroll periods yet.</div>}
          {periods.map((p) => (
            <div key={p.id} className="flex items-center justify-between p-3 rounded-md" style={{ background: "var(--surface-2)" }}>
              <div>
                <div className="font-medium">{p.name || `${p.start_date} – ${p.end_date}`}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {p.start_date} → {p.end_date}{p.pay_date && ` · pay ${p.pay_date}`}
                </div>
              </div>
              <button className="text-xs" onClick={() => removePeriod(p.id)} style={{ color: "var(--danger)" }}>Remove</button>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold mb-3">Outlets</h2>
        <form onSubmit={addOutlet} className="flex gap-2 mb-5">
          <input className="input" placeholder="Outlet name" value={newOutlet} onChange={(e) => setNewOutlet(e.target.value)} />
          <button className="btn btn-primary" type="submit">+ Add Outlet</button>
        </form>

        {outlets.length === 0 && <div className="text-sm" style={{ color: "var(--muted)" }}>No outlets yet.</div>}

        <div className="flex flex-col gap-4">
          {outlets.map((o) => {
            const oSvcs = services.filter((s) => s.outlet_id === o.id);
            const oRoles = roles.filter((r) => r.outlet_id === o.id);
            const rf = roleForm[o.id] ?? { role_name: "", points: "1" };
            return (
              <div key={o.id} className="p-4 rounded-lg" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold">{o.name}</h3>
                  <button className="text-xs" onClick={() => removeOutlet(o.id)} style={{ color: "var(--danger)" }}>Remove outlet</button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-medium mb-2" style={{ color: "var(--muted)" }}>Services</div>
                    <div className="flex gap-2 mb-2">
                      <input className="input" placeholder="Service name"
                        value={svcForm[o.id] ?? ""}
                        onChange={(e) => setSvcForm({ ...svcForm, [o.id]: e.target.value })} />
                      <button className="btn btn-secondary" onClick={() => addService(o.id)}>+</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {oSvcs.length === 0 && <span className="text-xs" style={{ color: "var(--muted)" }}>None</span>}
                      {oSvcs.map((s) => (
                        <span key={s.id} className="chip chip-muted flex items-center gap-2">
                          {s.name}
                          <button onClick={() => removeService(s.id)} style={{ color: "var(--danger)" }}>×</button>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-medium mb-2" style={{ color: "var(--muted)" }}>Roles (with points)</div>
                    <div className="flex gap-2 mb-2">
                      <input className="input" placeholder="Role name"
                        value={rf.role_name}
                        onChange={(e) => setRoleForm({ ...roleForm, [o.id]: { ...rf, role_name: e.target.value } })} />
                      <input className="input" style={{ maxWidth: 80 }} type="number" step="0.1" placeholder="Pts"
                        value={rf.points}
                        onChange={(e) => setRoleForm({ ...roleForm, [o.id]: { ...rf, points: e.target.value } })} />
                      <button className="btn btn-secondary" onClick={() => addRole(o.id)}>+</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {oRoles.length === 0 && <span className="text-xs" style={{ color: "var(--muted)" }}>None</span>}
                      {oRoles.map((r) => (
                        <span key={r.id} className="chip chip-green flex items-center gap-2">
                          {r.role_name} · {r.points}pt
                          <button onClick={() => removeRole(r.id)} style={{ color: "var(--danger)" }}>×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

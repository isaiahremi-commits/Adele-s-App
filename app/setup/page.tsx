"use client";
import { useEffect, useState } from "react";

type Outlet = { id: string; name: string };
type Service = { id: string; name: string; outlet_id: string };
type Role = { id: string; role_name: string; points: number; outlet_id: string };
type PayrollConfig = {
  pay_cycle: "weekly" | "biweekly";
  period_start_day: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
};

const DAYS: PayrollConfig["period_start_day"][] = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

export default function SetupPage() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [config, setConfig] = useState<PayrollConfig>({ pay_cycle: "weekly", period_start_day: "monday" });
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState<string | null>(null);

  const [newOutlet, setNewOutlet] = useState("");
  const [svcForm, setSvcForm] = useState<Record<string, string>>({});
  const [roleForm, setRoleForm] = useState<Record<string, { role_name: string; points: string }>>({});

  async function load() {
    const [o, s, r, c] = await Promise.all([
      fetch("/api/outlets").then((r) => r.json()),
      fetch("/api/services").then((r) => r.json()),
      fetch("/api/outlet-roles").then((r) => r.json()),
      fetch("/api/setup").then((r) => r.json()),
    ]);
    setOutlets(Array.isArray(o) ? o : []);
    setServices(Array.isArray(s) ? s : []);
    setRoles(Array.isArray(r) ? r : []);
    if (c && !c.error) {
      setConfig({
        pay_cycle: c.pay_cycle ?? "weekly",
        period_start_day: c.period_start_day ?? "monday",
      });
    }
  }
  useEffect(() => { load(); }, []);

  async function saveConfig(next: Partial<PayrollConfig>) {
    const merged = { ...config, ...next };
    setConfig(merged);
    setSavingConfig(true);
    setConfigMsg(null);
    try {
      const res = await fetch("/api/setup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(merged),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setConfigMsg(data.error || `Save failed (${res.status})`);
      else setConfigMsg("Saved");
    } catch (err) {
      setConfigMsg(err instanceof Error ? err.message : "Network error");
    } finally {
      setSavingConfig(false);
      setTimeout(() => setConfigMsg(null), 2000);
    }
  }

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

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Setup</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>Payroll configuration & outlet management</p>
      </header>

      <section className="card p-6 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Payroll Configuration</h2>
          {configMsg && (
            <span className="text-xs" style={{ color: configMsg === "Saved" ? "var(--primary)" : "var(--danger)" }}>
              {configMsg}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="text-sm">Pay Cycle
            <select
              className="input mt-1"
              value={config.pay_cycle}
              disabled={savingConfig}
              onChange={(e) => saveConfig({ pay_cycle: e.target.value as PayrollConfig["pay_cycle"] })}
            >
              <option value="weekly">Weekly</option>
              <option value="biweekly">Bi-weekly</option>
            </select>
          </label>
          <label className="text-sm">Period Starts On
            <select
              className="input mt-1"
              value={config.period_start_day}
              disabled={savingConfig}
              onChange={(e) => saveConfig({ period_start_day: e.target.value as PayrollConfig["period_start_day"] })}
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>
              ))}
            </select>
          </label>
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

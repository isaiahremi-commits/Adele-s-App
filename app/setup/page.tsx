"use client";
import { useEffect, useState } from "react";
import { PREDEFINED_ROLES, OTHER_OPTION } from "@/lib/constants";

type Outlet = { id: string; name: string; department_id?: string | null };
type Service = { id: string; name: string; outlet_id: string };
// is_tipped is absent until migration 017 lands — the toggle hides itself
// rather than 400ing against a column that doesn't exist yet.
type Role = { id: string; role_name: string; points: number; outlet_id: string; is_tipped?: boolean };
type Department = { id: string; name: string; type?: string; tip_pool_strategy?: string };
type PayrollConfig = {
  company_name: string;
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
  const [departments, setDepartments] = useState<Department[]>([]);
  const [config, setConfig] = useState<PayrollConfig>({
    company_name: "",
    pay_cycle: "weekly",
    period_start_day: "monday",
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState<string | null>(null);

  const [newOutlet, setNewOutlet] = useState("");
  const [newOutletDeptId, setNewOutletDeptId] = useState("");
  const [newDept, setNewDept] = useState("");
  const [newDeptType, setNewDeptType] = useState<"front_of_house" | "back_of_house" | "custom">("custom");
  const [deptError, setDeptError] = useState<string | null>(null);
  const [svcForm, setSvcForm] = useState<Record<string, string>>({});
  const [roleForm, setRoleForm] = useState<Record<string, { role_name: string; points: string; other?: boolean }>>({});
  const [outletError, setOutletError] = useState<Record<string, string>>({});

  // PR #26: PARS (staffing requirements) editor. Cells are keyed
  // "<dow>|<position lowercased>"; the baseline mirrors what the server
  // holds so Save only sends changed cells (0 = remove the requirement).
  const [parsOpen, setParsOpen] = useState<Set<string>>(new Set());
  const [parCells, setParCells] = useState<Record<string, Record<string, string>>>({});
  const [parBaseline, setParBaseline] = useState<Record<string, Record<string, number>>>({});
  const [parExtraRows, setParExtraRows] = useState<Record<string, string[]>>({});
  const [parSaving, setParSaving] = useState<string | null>(null);
  const [parMsg, setParMsg] = useState<Record<string, string>>({});

  async function load() {
    const [o, s, r, c, d] = await Promise.all([
      fetch("/api/outlets").then((r) => r.json()),
      fetch("/api/services").then((r) => r.json()),
      fetch("/api/outlet-roles").then((r) => r.json()),
      fetch("/api/setup").then((r) => r.json()),
      fetch("/api/departments").then((r) => r.json()),
    ]);
    setOutlets(Array.isArray(o) ? o : []);
    setServices(Array.isArray(s) ? s : []);
    setRoles(Array.isArray(r) ? r : []);
    setDepartments(Array.isArray(d) ? d : []);
    if (c && !c.error) {
      setConfig({
        company_name: c.company_name ?? "My Restaurant",
        pay_cycle: c.pay_cycle ?? "weekly",
        period_start_day: c.period_start_day ?? "monday",
      });
    }
  }
  useEffect(() => { load(); loadSmsSettings(); }, []);

  // ── PR #26: PARS editor helpers ────────────────────────────────────────
  const parKey = (dow: number, pos: string) => `${dow}|${pos.toLowerCase()}`;

  async function loadPars(outletId: string) {
    const rows = await fetch(`/api/pars?outlet_id=${outletId}`).then((r) => r.json()).catch(() => []);
    const cells: Record<string, string> = {};
    const base: Record<string, number> = {};
    const extras: string[] = [];
    const roleNames = new Set(roles.filter((r) => r.outlet_id === outletId).map((r) => r.role_name.toLowerCase()));
    for (const p of Array.isArray(rows) ? rows : []) {
      const k = parKey(p.day_of_week, p.position_name);
      cells[k] = String(p.required_count);
      base[k] = p.required_count;
      // A par can outlive its role (role deleted later) — keep it editable.
      if (!roleNames.has(p.position_name.toLowerCase()) &&
          !extras.some((e) => e.toLowerCase() === p.position_name.toLowerCase())) {
        extras.push(p.position_name);
      }
    }
    setParCells((prev) => ({ ...prev, [outletId]: cells }));
    setParBaseline((prev) => ({ ...prev, [outletId]: base }));
    setParExtraRows((prev) => ({ ...prev, [outletId]: extras }));
  }

  function toggleParSection(outletId: string) {
    setParsOpen((prev) => {
      const next = new Set(prev);
      if (next.has(outletId)) next.delete(outletId);
      else next.add(outletId);
      return next;
    });
    if (!parCells[outletId]) loadPars(outletId);
  }

  function setParCell(outletId: string, dow: number, pos: string, val: string) {
    setParCells((prev) => ({
      ...prev,
      [outletId]: { ...(prev[outletId] ?? {}), [parKey(dow, pos)]: val },
    }));
  }

  async function saveParsFor(outletId: string, rowNames: string[]) {
    const cells = parCells[outletId] ?? {};
    const base = parBaseline[outletId] ?? {};
    const changed: Array<{ day_of_week: number; position_name: string; required_count: number }> = [];
    for (const pos of rowNames) {
      for (let dow = 0; dow < 7; dow++) {
        const raw = cells[parKey(dow, pos)];
        const val = Math.max(0, Math.min(99, Number(raw) || 0));
        if (val !== (base[parKey(dow, pos)] ?? 0)) {
          changed.push({ day_of_week: dow, position_name: pos, required_count: val });
        }
      }
    }
    if (changed.length === 0) {
      setParMsg((m) => ({ ...m, [outletId]: "No changes" }));
      setTimeout(() => setParMsg((m) => ({ ...m, [outletId]: "" })), 2000);
      return;
    }
    setParSaving(outletId);
    try {
      const res = await fetch("/api/pars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outlet_id: outletId, pars: changed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setParMsg((m) => ({ ...m, [outletId]: data.error || `Save failed (${res.status})` }));
      else {
        setParMsg((m) => ({ ...m, [outletId]: "Saved" }));
        await loadPars(outletId); // refresh the baseline
      }
    } catch (err) {
      setParMsg((m) => ({ ...m, [outletId]: err instanceof Error ? err.message : "Network error" }));
    } finally {
      setParSaving(null);
      setTimeout(() => setParMsg((m) => ({ ...m, [outletId]: "" })), 2500);
    }
  }

  async function saveConfig(next: Partial<PayrollConfig>) {
    const merged = { ...config, ...next };
    setConfig(merged);
    setSavingConfig(true);
    setConfigMsg(null);
    try {
      const res = await fetch("/api/setup", {
        method: "PATCH",
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

  type SmsSettings = {
    schedule_published_enabled: boolean;
    shift_reminder_enabled: boolean;
    shift_reminder_hours_before: number;
    tip_approved_enabled: boolean;
  };

  const [smsSettings, setSmsSettings] = useState<SmsSettings | null>(null);
  const [smsSavingKey, setSmsSavingKey] = useState<string | null>(null);

  async function loadSmsSettings() {
    try {
      const res = await fetch("/api/sms/settings");
      const data = await res.json();
      setSmsSettings(data);
    } catch {
      // ignore
    }
  }

  async function updateSmsSetting(patch: Partial<SmsSettings>) {
    setSmsSavingKey(Object.keys(patch)[0] ?? "");
    try {
      const res = await fetch("/api/sms/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (res.ok) setSmsSettings(data);
    } catch {
      // ignore
    } finally {
      setSmsSavingKey(null);
    }
  }

  async function addDepartment(e: React.FormEvent) {
    e.preventDefault();
    setDeptError(null);
    if (!newDept.trim()) return;
    const normalized = newDept.trim().toLowerCase();
    if (departments.some((d) => d.name.trim().toLowerCase() === normalized)) {
      setDeptError(`A department named "${newDept.trim()}" already exists.`);
      return;
    }
    const tipPoolStrategy = newDeptType === "back_of_house" ? "pooled_across_outlets" : "per_outlet_per_shift";
    const res = await fetch("/api/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newDept, type: newDeptType, tip_pool_strategy: tipPoolStrategy }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setDeptError(data.error || `Save failed (${res.status})`);
      return;
    }
    setNewDept("");
    setNewDeptType("custom");
    load();
  }

  async function removeDepartment(id: string) {
    if (!confirm("Remove this department?")) return;
    await fetch(`/api/departments/${id}`, { method: "DELETE" });
    load();
  }

  async function addOutlet(e: React.FormEvent) {
    e.preventDefault();
    if (!newOutlet.trim()) return;
    const normalized = newOutlet.trim().toLowerCase();
    if (outlets.some((o) => o.name.trim().toLowerCase() === normalized)) {
      setDeptError(`An outlet named "${newOutlet.trim()}" already exists.`);
      return;
    }
    await fetch("/api/outlets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newOutlet,
        department_id: newOutletDeptId || null,
      }),
    });
    setNewOutlet("");
    setNewOutletDeptId("");
    load();
  }

  async function removeOutlet(id: string) {
    if (!confirm("Remove outlet and all its shifts/roles?")) return;
    await fetch(`/api/outlets/${id}`, { method: "DELETE" });
    load();
  }

  async function addService(outletId: string) {
    const name = svcForm[outletId]?.trim();
    if (!name) return;
    const normalized = name.toLowerCase();
    const duplicate = services.some(
      (s) => s.outlet_id === outletId && s.name.trim().toLowerCase() === normalized
    );
    if (duplicate) {
      setOutletError({ ...outletError, [outletId]: `Shift type "${name}" already exists for this outlet.` });
      return;
    }
    const res = await fetch("/api/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, outlet_id: outletId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setOutletError({ ...outletError, [outletId]: data.error || `Shift save failed (${res.status})` });
      return;
    }
    setOutletError({ ...outletError, [outletId]: "" });
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
    const normalized = f.role_name.trim().toLowerCase();
    const duplicate = roles.some(
      (r) => r.outlet_id === outletId && r.role_name.trim().toLowerCase() === normalized
    );
    if (duplicate) {
      setOutletError({ ...outletError, [outletId]: `Role "${f.role_name.trim()}" already exists for this outlet.` });
      return;
    }
    const res = await fetch("/api/outlet-roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        position_name: f.role_name,
        points: Number(f.points) || 1,
        outlet_id: outletId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setOutletError({ ...outletError, [outletId]: data.error || `Role save failed (${res.status})` });
      return;
    }
    setOutletError({ ...outletError, [outletId]: "" });
    setRoleForm({ ...roleForm, [outletId]: { role_name: "", points: "1" } });
    load();
  }

  async function removeRole(id: string) {
    await fetch(`/api/outlet-roles/${id}`, { method: "DELETE" });
    load();
  }

  // Tipped-position toggle (PR #16). Non-tipped roles sit out ts_compute's
  // distribution and their employees see no tip UI on mobile.
  async function toggleTipped(r: Role) {
    const res = await fetch(`/api/outlet-roles/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_tipped: !(r.is_tipped ?? true) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setOutletError({ ...outletError, [r.outlet_id]: data.error || `Save failed (${res.status})` });
      return;
    }
    setOutletError({ ...outletError, [r.outlet_id]: "" });
    load();
  }

  function deptLabel(d: Department): string {
    if (d.type === "front_of_house") return "Front of House";
    if (d.type === "back_of_house") return "Back of House";
    return "Custom";
  }

  function deptChipClass(d: Department): string {
    if (d.type === "front_of_house") return "chip-green";
    if (d.type === "back_of_house") return "chip-amber";
    return "chip-muted";
  }

  // SMS is a Phase 2 feature — hidden by default. Set NEXT_PUBLIC_SMS_ENABLED=true to surface it.
  const smsEnabled = process.env.NEXT_PUBLIC_SMS_ENABLED === "true";

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Setup</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>Company, payroll, departments, and outlet management</p>
      </header>

      <section className="card p-6 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Company</h2>
          {configMsg && (
            <span className="text-xs" style={{ color: configMsg === "Saved" ? "var(--primary)" : "var(--danger)" }}>
              {configMsg}
            </span>
          )}
        </div>
        <label className="text-sm block">Restaurant / Company Name
          <input
            className="input mt-1"
            value={config.company_name}
            placeholder="e.g. Manadel"
            onChange={(e) => setConfig({ ...config, company_name: e.target.value })}
            onBlur={(e) => saveConfig({ company_name: e.target.value })}
          />
        </label>
        <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>
          This name shows in the sidebar and app header.
        </p>
      </section>

      <section className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-3">Payroll Configuration</h2>
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

      {smsEnabled && (
      <section className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-1">SMS Notifications</h2>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <p className="text-xs flex-1" style={{ color: "var(--muted)" }}>
            Configure which automatic text notifications get sent. Employees must opt in individually before they receive any messages.
          </p>
          <a href="/setup/sms-log" className="text-xs" style={{ color: "var(--primary)", whiteSpace: "nowrap" }}>
            View SMS log &rarr;
          </a>
        </div>

        {!smsSettings ? (
          <div className="text-xs" style={{ color: "var(--muted)" }}>Loading...</div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex items-start justify-between gap-3 p-3 rounded-md" style={{ background: "var(--surface-2)" }}>
              <div className="flex-1">
                <div className="text-sm font-medium">Schedule published</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                  Text employees when a weekly schedule is approved.
                </div>
              </div>
              <input
                type="checkbox"
                checked={smsSettings.schedule_published_enabled}
                onChange={(e) => updateSmsSetting({ schedule_published_enabled: e.target.checked })}
                disabled={smsSavingKey === "schedule_published_enabled"}
                style={{ marginTop: 2 }}
              />
            </label>

            <label className="flex items-start justify-between gap-3 p-3 rounded-md" style={{ background: "var(--surface-2)" }}>
              <div className="flex-1">
                <div className="text-sm font-medium">Shift reminder</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                  Text employees a few hours before their shift starts. Requires Vercel Cron setup (Phase 2).
                </div>
                {smsSettings.shift_reminder_enabled && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs" style={{ color: "var(--muted)" }}>Hours before:</span>
                    <input
                      type="number"
                      min={1}
                      max={24}
                      className="input"
                      style={{ maxWidth: 70, padding: "4px 8px" }}
                      value={smsSettings.shift_reminder_hours_before}
                      onChange={(e) => updateSmsSetting({ shift_reminder_hours_before: Number(e.target.value) })}
                    />
                  </div>
                )}
              </div>
              <input
                type="checkbox"
                checked={smsSettings.shift_reminder_enabled}
                onChange={(e) => updateSmsSetting({ shift_reminder_enabled: e.target.checked })}
                disabled={smsSavingKey === "shift_reminder_enabled"}
                style={{ marginTop: 2 }}
              />
            </label>

            <label className="flex items-start justify-between gap-3 p-3 rounded-md" style={{ background: "var(--surface-2)" }}>
              <div className="flex-1">
                <div className="text-sm font-medium">Tip sheet approved</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                  Text employees their tip amount when a tip sheet is approved and locked.
                </div>
              </div>
              <input
                type="checkbox"
                checked={smsSettings.tip_approved_enabled}
                onChange={(e) => updateSmsSetting({ tip_approved_enabled: e.target.checked })}
                disabled={smsSavingKey === "tip_approved_enabled"}
                style={{ marginTop: 2 }}
              />
            </label>
          </div>
        )}
      </section>
      )}

      <section className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-1">Departments</h2>
        <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
          Front of House = tips pool per outlet per shift. Back of House = one pool across all outlets.
        </p>
        <form onSubmit={addDepartment} className="flex gap-2 mb-4 flex-wrap">
          <input
            className="input flex-1 min-w-[200px]"
            placeholder="Department name"
            value={newDept}
            onChange={(e) => setNewDept(e.target.value)}
          />
          <select
            className="input"
            style={{ maxWidth: 220 }}
            value={newDeptType}
            onChange={(e) => setNewDeptType(e.target.value as typeof newDeptType)}
          >
            <option value="custom">Custom</option>
            <option value="front_of_house">Front of House</option>
            <option value="back_of_house">Back of House</option>
          </select>
          <button className="btn btn-primary" type="submit">Add Department</button>
        </form>
        {deptError && (
          <div className="text-sm mb-3 p-2 rounded-md" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>
            {deptError}
          </div>
        )}
        {departments.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>No departments yet.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {departments.map((d) => (
              <span key={d.id} className={`chip ${deptChipClass(d)} flex items-center gap-2`}>
                {d.name} <span className="opacity-60">({deptLabel(d)})</span>
                <button onClick={() => removeDepartment(d.id)} style={{ color: "var(--danger)" }}>×</button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-3">Outlets</h2>
        <form onSubmit={addOutlet} className="flex gap-2 mb-5 flex-wrap">
          <input
            className="input flex-1 min-w-[200px]"
            placeholder="Outlet name"
            value={newOutlet}
            onChange={(e) => setNewOutlet(e.target.value)}
          />
          <select
            className="input"
            style={{ maxWidth: 220 }}
            value={newOutletDeptId}
            onChange={(e) => setNewOutletDeptId(e.target.value)}
          >
            <option value="">No department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <button className="btn btn-primary" type="submit">Add Outlet</button>
        </form>

        {outlets.length === 0 && <div className="text-sm" style={{ color: "var(--muted)" }}>No outlets yet.</div>}

        <div className="flex flex-col gap-4">
          {outlets.map((o) => {
            const oSvcs = services.filter((s) => s.outlet_id === o.id);
            const oRoles = roles.filter((r) => r.outlet_id === o.id);
            const rf = roleForm[o.id] ?? { role_name: "", points: "1" };
            const dept = departments.find((d) => d.id === o.department_id);
            return (
              <div key={o.id} className="p-4 rounded-lg" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{o.name}</h3>
                    {dept && (
                      <span className={`chip ${deptChipClass(dept)}`} style={{ fontSize: 10 }}>
                        {dept.name}
                      </span>
                    )}
                  </div>
                  <button className="text-xs" onClick={() => removeOutlet(o.id)} style={{ color: "var(--danger)" }}>Remove outlet</button>
                </div>
                {outletError[o.id] && (
                  <div className="text-xs mb-3 p-2 rounded-md" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>
                    {outletError[o.id]}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-medium mb-2" style={{ color: "var(--muted)" }}>Shifts</div>
                    <div className="flex gap-2 mb-2">
                      <input className="input" placeholder="Shift name"
                        value={svcForm[o.id] ?? ""}
                        onChange={(e) => setSvcForm({ ...svcForm, [o.id]: e.target.value })} />
                      <button className="btn btn-secondary" onClick={() => addService(o.id)}>Add</button>
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
                    <div className="flex gap-2 mb-2 flex-wrap">
                      {/* Item 4: predefined role dropdown + Other */}
                      <select className="input" style={{ maxWidth: 170 }}
                        value={rf.other ? OTHER_OPTION : rf.role_name}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === OTHER_OPTION) setRoleForm({ ...roleForm, [o.id]: { ...rf, role_name: "", other: true } });
                          else setRoleForm({ ...roleForm, [o.id]: { ...rf, role_name: v, other: false } });
                        }}>
                        <option value="">Select role…</option>
                        {PREDEFINED_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        <option value={OTHER_OPTION}>{OTHER_OPTION}</option>
                      </select>
                      {rf.other && (
                        <input className="input" placeholder="Custom role"
                          value={rf.role_name}
                          onChange={(e) => setRoleForm({ ...roleForm, [o.id]: { ...rf, role_name: e.target.value } })} />
                      )}
                      <input className="input" style={{ maxWidth: 80 }} type="number" step="0.1" placeholder="Pts"
                        value={rf.points}
                        onChange={(e) => setRoleForm({ ...roleForm, [o.id]: { ...rf, points: e.target.value } })} />
                      <button className="btn btn-secondary" onClick={() => addRole(o.id)}>Add</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {oRoles.length === 0 && <span className="text-xs" style={{ color: "var(--muted)" }}>None</span>}
                      {oRoles.map((r) => (
                        <span key={r.id} className={`chip ${r.is_tipped === false ? "chip-amber" : "chip-green"} flex items-center gap-2`}>
                          {r.role_name} · {r.points}pt
                          {r.is_tipped !== undefined && (
                            <button
                              onClick={() => toggleTipped(r)}
                              title={r.is_tipped
                                ? "Tipped position — employees declare tips and join the distribution. Click to mark non-tipped."
                                : "Non-tipped position — excluded from tip sheets and tip UI. Click to mark tipped."}
                              style={{ fontSize: 10, textDecoration: "underline", opacity: 0.85 }}
                            >
                              {r.is_tipped ? "Tipped" : "Non-tipped"}
                            </button>
                          )}
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

      {/* PR #26: PARS — staffing requirements per outlet × day × position. */}
      <section className="card p-6">
        <h2 className="text-lg font-semibold mb-1">Staffing requirements</h2>
        <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
          Set how many people you need scheduled per position per day. Get an alert on the
          Schedule page when you&apos;re above or below these numbers.
        </p>
        {outlets.length === 0 && <div className="text-sm" style={{ color: "var(--muted)" }}>Add an outlet first.</div>}
        <div className="flex flex-col gap-3">
          {outlets.map((o) => {
            const open = parsOpen.has(o.id);
            const roleRows = roles.filter((r) => r.outlet_id === o.id).map((r) => r.role_name);
            const rowNames = [...roleRows, ...(parExtraRows[o.id] ?? [])];
            const cells = parCells[o.id] ?? {};
            return (
              <div key={o.id} className="rounded-lg" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <button
                  onClick={() => toggleParSection(o.id)}
                  className="w-full flex items-center justify-between p-4 text-left"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "inherit" }}
                >
                  <span className="font-semibold">{o.name}</span>
                  <span style={{ color: "var(--muted)" }}>{open ? "▾" : "▸"}</span>
                </button>
                {open && (
                  <div className="px-4 pb-4 overflow-x-auto">
                    {rowNames.length === 0 ? (
                      <p className="text-sm" style={{ color: "var(--muted)" }}>
                        No roles configured for this outlet yet — add roles above first.
                      </p>
                    ) : (
                      <>
                        <table className="text-sm" style={{ minWidth: 560 }}>
                          <thead>
                            <tr style={{ color: "var(--muted)" }}>
                              <th className="text-left py-1 pr-4 font-medium">Position</th>
                              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                                <th key={d} className="text-center py-1 px-1 font-medium">{d}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rowNames.map((pos) => (
                              <tr key={pos}>
                                <td className="py-1 pr-4 whitespace-nowrap">
                                  {pos}
                                  {!roleRows.includes(pos) && (
                                    <span className="chip chip-muted ml-2" style={{ fontSize: 10 }} title="This role was removed from the outlet; its requirement is still set.">removed role</span>
                                  )}
                                </td>
                                {[0, 1, 2, 3, 4, 5, 6].map((dow) => (
                                  <td key={dow} className="py-1 px-1 text-center">
                                    <input
                                      type="number" min={0} max={99}
                                      className="input"
                                      style={{ width: 56, textAlign: "center", padding: "4px 6px" }}
                                      value={cells[parKey(dow, pos)] ?? ""}
                                      placeholder="0"
                                      onChange={(e) => setParCell(o.id, dow, pos, e.target.value)}
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="flex items-center gap-3 mt-3">
                          <button className="btn btn-primary" disabled={parSaving === o.id}
                            onClick={() => saveParsFor(o.id, rowNames)}>
                            {parSaving === o.id ? "Saving…" : "Save requirements"}
                          </button>
                          {parMsg[o.id] && (
                            <span className="text-sm" style={{ color: parMsg[o.id] === "Saved" ? "var(--primary)" : "var(--muted)" }}>
                              {parMsg[o.id]}
                            </span>
                          )}
                          <span className="text-xs" style={{ color: "var(--muted)" }}>Empty or 0 = no requirement.</span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

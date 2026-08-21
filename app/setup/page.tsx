"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

// PR #28 — Setup is now an "Establishment" landing page: name + payroll
// frequency up top, then the department cards. Departments → outlets →
// positions/team live on their own pages (/setup/departments/[id],
// /setup/outlets/[id]). The old flat Outlets / Roles / PARS sections moved
// to the outlet page.

type DepartmentCard = {
  id: string;
  name: string;
  type: string | null;
  outlet_count: number;
  position_count: number;
};
type PayrollConfig = {
  company_name: string;
  pay_cycle: "weekly" | "biweekly";
  period_start_day: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
};

const DAYS: PayrollConfig["period_start_day"][] = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

export default function SetupPage() {
  const [departments, setDepartments] = useState<DepartmentCard[] | null>(null);
  const [config, setConfig] = useState<PayrollConfig>({
    company_name: "",
    pay_cycle: "weekly",
    period_start_day: "monday",
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState<string | null>(null);

  const [newDept, setNewDept] = useState("");
  const [deptError, setDeptError] = useState<string | null>(null);
  const [addingDept, setAddingDept] = useState(false);

  async function load() {
    const [d, c] = await Promise.all([
      fetch("/api/departments/list").then((r) => r.json()).catch(() => []),
      fetch("/api/setup").then((r) => r.json()).catch(() => null),
    ]);
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
    if (!newDept.trim() || addingDept) return;
    setAddingDept(true);
    try {
      const res = await fetch("/api/departments/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newDept.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeptError(data.error || `Save failed (${res.status})`);
        return;
      }
      setNewDept("");
      load();
    } finally {
      setAddingDept(false);
    }
  }

  function legacyTypeLabel(type: string | null): string | null {
    if (type === "front_of_house") return "Front of House";
    if (type === "back_of_house") return "Back of House";
    return null;
  }

  // SMS is a Phase 2 feature — hidden by default. Set NEXT_PUBLIC_SMS_ENABLED=true to surface it.
  const smsEnabled = process.env.NEXT_PUBLIC_SMS_ENABLED === "true";

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Setup</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Your establishment: payroll, departments, outlets, and positions
        </p>
      </header>

      <section className="card p-6 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Establishment</h2>
          {configMsg && (
            <span className="text-xs" style={{ color: configMsg === "Saved" ? "var(--primary)" : "var(--danger)" }}>
              {configMsg}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="text-sm md:col-span-1">Establishment Name
            <input
              className="input mt-1"
              value={config.company_name}
              placeholder="e.g. Manadel"
              onChange={(e) => setConfig({ ...config, company_name: e.target.value })}
              onBlur={(e) => saveConfig({ company_name: e.target.value })}
            />
          </label>
          <label className="text-sm">Payroll Frequency
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
        <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>
          The name shows in the sidebar and app header.
        </p>
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

      <section className="card p-6">
        <h2 className="text-lg font-semibold mb-1">Departments</h2>
        <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
          Your establishment&apos;s departments hold positions and outlets. Click a
          department to manage its positions, outlets, and team assignments.
        </p>
        <form onSubmit={addDepartment} className="flex gap-2 mb-4 flex-wrap">
          <input
            className="input flex-1 min-w-[200px]"
            placeholder="Department name (e.g. Front of House)"
            value={newDept}
            onChange={(e) => setNewDept(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={addingDept}>
            {addingDept ? "Adding…" : "+ Add department"}
          </button>
        </form>
        {deptError && (
          <div className="text-sm mb-3 p-2 rounded-md" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>
            {deptError}
          </div>
        )}
        {departments === null ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>Loading…</div>
        ) : departments.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            No departments yet — add your first one above.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {departments.map((d) => (
              <Link
                key={d.id}
                href={`/setup/departments/${d.id}`}
                className="p-4 rounded-lg block"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "inherit", textDecoration: "none" }}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-semibold">{d.name}</span>
                  <span style={{ color: "var(--muted)" }}>›</span>
                </div>
                {legacyTypeLabel(d.type) && (
                  <span className={`chip ${d.type === "back_of_house" ? "chip-amber" : "chip-green"}`} style={{ fontSize: 10 }}>
                    {legacyTypeLabel(d.type)}
                  </span>
                )}
                <div className="text-xs mt-2" style={{ color: "var(--muted)" }}>
                  {d.outlet_count} outlet{d.outlet_count === 1 ? "" : "s"} · {d.position_count} position{d.position_count === 1 ? "" : "s"}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

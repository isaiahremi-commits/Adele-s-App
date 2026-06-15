"use client";
import { useCallback, useEffect, useState } from "react";
import TimeWindowFilter from "@/components/TimeWindowFilter";
import type { Window } from "@/lib/timeWindow";
import { format12h } from "@/lib/format";

type Tab = "lateness" | "callouts" | "disciplinary";

type LatenessRow = {
  employee_id: string; name: string; tier1: number; tier2: number; avg_minutes: number; latest_date: string | null;
  incidents: { date: string; scheduled_start: string | null; clock_in: string | null; minutes_late: number; tier: number }[];
};
type CalloutRow = {
  employee_id: string; name: string; count: number; latest_date: string | null; threshold_flag: boolean;
  incidents: { date: string; shift_type: string | null; reason: string | null; entered_by: string | null }[];
};
type DiscRow = {
  employee_id: string; name: string; tier1: number; tier2: number; callouts: number; total: number;
  callout_flag: boolean; escalation: boolean; feed: { date: string; type: "lateness" | "callout"; detail: string }[];
};

function timeOf(iso: string | null): string {
  return format12h(iso) || "—"; // Item 12: 12-hour AM/PM display.
}
function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

type NamedRow = { id: string; name: string };

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>("lateness");
  const [win, setWin] = useState<Window | null>(null);
  const [data, setData] = useState<{ thresholds?: Record<string, number>; rows: (LatenessRow | CalloutRow | DiscRow)[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState<LatenessRow | CalloutRow | DiscRow | null>(null);
  // Item 3: department + outlet filters (per-tab, persisted, AND with the window).
  const [departments, setDepartments] = useState<NamedRow[]>([]);
  const [outlets, setOutlets] = useState<NamedRow[]>([]);
  const [dept, setDept] = useState("");
  const [outlet, setOutlet] = useState("");

  useEffect(() => {
    fetch("/api/departments").then((r) => r.json()).then((d) => setDepartments(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/outlets").then((r) => r.json()).then((o) => setOutlets(Array.isArray(o) ? o : [])).catch(() => {});
  }, []);

  // Load this tab's saved dept/outlet whenever the tab changes.
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(`reports_${tab}_filters`) || "{}");
      setDept(s.dept || ""); setOutlet(s.outlet || "");
    } catch { setDept(""); setOutlet(""); }
  }, [tab]);

  function persistFilters(next: { dept: string; outlet: string }) {
    localStorage.setItem(`reports_${tab}_filters`, JSON.stringify(next));
  }

  const load = useCallback(async (t: Tab, w: Window, d: string, o: string) => {
    setLoading(true); setDrawer(null);
    const q = new URLSearchParams({ start: w.start, end: w.end });
    if (d) q.set("dept", d);
    if (o) q.set("outlet", o);
    const res = await fetch(`/api/reports/${t}?${q.toString()}`).then((r) => r.json()).catch(() => ({ rows: [] }));
    setData(res); setLoading(false);
  }, []);

  useEffect(() => { if (win) load(tab, win, dept, outlet); }, [tab, win, dept, outlet, load]);

  function exportCSV() {
    if (!win || !data) return;
    const fn = `${tab}_${win.start}_to_${win.end}.csv`;
    if (tab === "lateness") {
      downloadCSV(fn, ["Employee", "Tier 1", "Tier 2", "Avg min late", "Latest"],
        (data.rows as LatenessRow[]).map((r) => [r.name, r.tier1, r.tier2, r.avg_minutes, r.latest_date ?? ""]));
    } else if (tab === "callouts") {
      downloadCSV(fn, ["Employee", "Callouts", "Latest", "Threshold flag"],
        (data.rows as CalloutRow[]).map((r) => [r.name, r.count, r.latest_date ?? "", r.threshold_flag ? "YES" : ""]));
    } else {
      downloadCSV(fn, ["Employee", "Tier 1", "Tier 2", "Callouts", "Total", "Callout flag", "Escalation"],
        (data.rows as DiscRow[]).map((r) => [r.name, r.tier1, r.tier2, r.callouts, r.total, r.callout_flag ? "YES" : "", r.escalation ? "YES" : ""]));
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "lateness", label: "Lateness" }, { id: "callouts", label: "Callouts" }, { id: "disciplinary", label: "Disciplinary" },
  ];

  return (
    <div className="max-w-[1100px] page-shell">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Reports</h1>
        <button className="btn btn-secondary" onClick={exportCSV} disabled={!data || (data.rows?.length ?? 0) === 0}>Export CSV</button>
      </div>

      <div className="inline-flex rounded-lg p-1 mb-4" style={{ background: "var(--surface-2)" }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className="text-xs px-3 py-1 rounded-md"
            style={{ background: tab === t.id ? "var(--surface)" : "transparent", color: tab === t.id ? "var(--primary)" : "var(--muted)", fontWeight: tab === t.id ? 600 : 400, border: "none", cursor: "pointer" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* one filter per tab, remounts on tab change to load that tab's saved kind */}
      <TimeWindowFilter key={tab} storageKey={`reports_${tab}_window`} onChange={setWin} />

      {/* Item 3: department + outlet filters (AND with the time window). */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select className="input" style={{ width: 200 }} value={dept}
          onChange={(e) => { setDept(e.target.value); persistFilters({ dept: e.target.value, outlet }); }}>
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="input" style={{ width: 200 }} value={outlet}
          onChange={(e) => { setOutlet(e.target.value); persistFilters({ dept, outlet: e.target.value }); }}>
          <option value="">All outlets</option>
          {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      <div className="card overflow-x-auto">
        {loading ? <div className="p-6 text-center" style={{ color: "var(--muted)" }}>Loading…</div> : (
          <table className="w-full text-sm">
            <thead><tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
              {tab === "lateness" && <><th className="text-left p-3">Employee</th><th className="text-right p-3">Tier 1</th><th className="text-right p-3">Tier 2</th><th className="text-right p-3">Avg min late</th><th className="text-left p-3">Latest</th></>}
              {tab === "callouts" && <><th className="text-left p-3">Employee</th><th className="text-right p-3">Callouts</th><th className="text-left p-3">Latest</th><th className="text-left p-3">Flag</th></>}
              {tab === "disciplinary" && <><th className="text-left p-3">Employee</th><th className="text-right p-3">Tier 1</th><th className="text-right p-3">Tier 2</th><th className="text-right p-3">Callouts</th><th className="text-right p-3">Total</th><th className="text-left p-3">Flags</th></>}
            </tr></thead>
            <tbody>
              {(data?.rows?.length ?? 0) === 0 && <tr><td colSpan={6} className="p-6 text-center" style={{ color: "var(--muted)" }}>No incidents in this window.</td></tr>}
              {tab === "lateness" && (data?.rows as LatenessRow[] ?? []).map((r) => (
                <tr key={r.employee_id} style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }} onClick={() => setDrawer(r)}>
                  <td className="p-3">{r.name}</td><td className="p-3 text-right">{r.tier1}</td>
                  <td className="p-3 text-right">{r.tier2 > 0 ? <span className="chip chip-amber">{r.tier2}</span> : 0}</td>
                  <td className="p-3 text-right">{r.avg_minutes}</td><td className="p-3">{r.latest_date ?? "—"}</td>
                </tr>
              ))}
              {tab === "callouts" && (data?.rows as CalloutRow[] ?? []).map((r) => (
                <tr key={r.employee_id} style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }} onClick={() => setDrawer(r)}>
                  <td className="p-3">{r.name}</td><td className="p-3 text-right">{r.count}</td><td className="p-3">{r.latest_date ?? "—"}</td>
                  <td className="p-3">{r.threshold_flag && <span className="chip chip-amber">⚠ threshold</span>}</td>
                </tr>
              ))}
              {tab === "disciplinary" && (data?.rows as DiscRow[] ?? []).map((r) => (
                <tr key={r.employee_id} style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }} onClick={() => setDrawer(r)}>
                  <td className="p-3">{r.name}</td><td className="p-3 text-right">{r.tier1}</td><td className="p-3 text-right">{r.tier2}</td>
                  <td className="p-3 text-right">{r.callouts}</td><td className="p-3 text-right font-semibold">{r.total}</td>
                  <td className="p-3">
                    {r.escalation ? <span className="chip" style={{ background: "rgba(239,90,90,0.15)", color: "var(--danger)" }}>⚠ escalation</span>
                      : r.callout_flag ? <span className="chip chip-amber">⚠ callouts</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setDrawer(null)}>
          <div className="h-full overflow-y-auto p-6" style={{ width: 460, maxWidth: "100%", background: "var(--surface)", borderLeft: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">{drawer.name}</h3>
              <button className="text-xl" style={{ color: "var(--muted)" }} onClick={() => setDrawer(null)}>×</button>
            </div>
            {tab === "lateness" && (drawer as LatenessRow).incidents.map((i, idx) => (
              <div key={idx} className="p-2 mb-2 rounded-md text-xs" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <div className="flex justify-between"><span>{i.date}</span><span className={`chip ${i.tier === 2 ? "chip-amber" : "chip-muted"}`}>Tier {i.tier}</span></div>
                <div style={{ color: "var(--muted)" }}>Scheduled {format12h(i.scheduled_start) || "—"} · clocked {timeOf(i.clock_in)} · {i.minutes_late} min late</div>
              </div>
            ))}
            {tab === "callouts" && (drawer as CalloutRow).incidents.map((i, idx) => (
              <div key={idx} className="p-2 mb-2 rounded-md text-xs" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <div className="flex justify-between"><span>{i.date}</span><span style={{ color: "var(--muted)" }}>{i.shift_type ?? ""}</span></div>
                <div style={{ color: "var(--muted)" }}>{i.reason ?? "—"}{i.entered_by ? ` · by ${i.entered_by}` : ""}</div>
              </div>
            ))}
            {tab === "disciplinary" && (drawer as DiscRow).feed.map((i, idx) => (
              <div key={idx} className="p-2 mb-2 rounded-md text-xs" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <div className="flex justify-between"><span>{i.date}</span><span className={`chip ${i.type === "lateness" ? "chip-amber" : "chip-muted"}`}>{i.type}</span></div>
                <div style={{ color: "var(--muted)" }}>{i.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

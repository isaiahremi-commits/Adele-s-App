"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";
import { createClient } from "@/lib/supabase";
import { useMounted } from "@/lib/useMounted";
import { buildEarningsCSV, buildHoursCSV } from "@/lib/payrollExport";
import {
  cycleLength,
  currentPeriod,
  previousPeriod,
  nextPeriod,
  formatPeriod,
  todayISO,
  type Period,
} from "@/lib/payroll";

type PayRow = {
  employee_id: string;
  first_name: string;
  last_name: string;
  title: string | null;
  department: string | null;
  job_position: string | null;
  outlet_name: string | null;
  regular_hours: string | number;
  ot_hours: string | number;
  training_hours: string | number;
  pto_hours: string | number;
  projected_hours: string | number;
  approved_count: number;
  scheduled_count: number;
  regular_rate: string | number | null;
  regular_pay: string | number | null;
  ot_pay: string | number | null;
  training_pay: string | number | null;
  pto_pay: string | number | null;
  manager_amount: string | number;
  tip_pay: string | number | null;
  gross_pay: string | number | null;
  has_missing_rate: boolean;
  warnings: string[];
};

type Mode = "actual" | "prediction";
type Toast = { kind: "success" | "error"; text: string } | null;

function cents(n: string | number | null): number {
  if (n === null || n === undefined || n === "") return 0;
  return Math.round(Number(n) * 100);
}
function money(n: string | number | null): string {
  if (n === null || n === undefined) return "—";
  return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function hrs(n: string | number): string {
  return Number(n).toFixed(2);
}

function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function PayrollPage() {
  const mounted = useMounted();
  const [cycle, setCycle] = useState(14);
  const [period, setPeriod] = useState<Period>(() => currentPeriod(14, todayISO()));
  const [mode, setMode] = useState<Mode>("actual");
  const [rows, setRows] = useState<PayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  // Export support: employee_number map (not in pay_breakdown) + pay frequency.
  const [empNumbers, setEmpNumbers] = useState<Record<string, string>>({});
  const [payCycle, setPayCycle] = useState("biweekly");
  const [validate, setValidate] = useState<{ kind: "earnings" | "hours"; missingRates: PayRow[]; unposted: number } | null>(null);

  // Resolve the configured cycle once, then re-anchor the default period.
  useEffect(() => {
    fetch("/api/setup")
      .then((r) => r.json())
      .then((s) => {
        setPayCycle(s?.pay_cycle ?? "biweekly");
        const c = cycleLength(s?.pay_cycle ?? "biweekly");
        setCycle(c);
        setPeriod(currentPeriod(c, todayISO()));
      })
      .catch(() => {});
    // employee_number isn't part of pay_breakdown — fetch it for the export.
    fetch("/api/employees")
      .then((r) => r.json())
      .then((list) => {
        const m: Record<string, string> = {};
        for (const e of Array.isArray(list) ? list : []) if (e.employee_number) m[e.id] = String(e.employee_number);
        setEmpNumbers(m);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/payroll?start=${period.start}&end=${period.end}&mode=${mode}`).then((r) => r.json());
    setRows(Array.isArray(res) ? res : []);
    setLoading(false);
  }, [period, mode]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const anyIncomplete = rows.some((r) => r.has_missing_rate);

  // Cents-safe rollups by outlet and department.
  const rollups = useMemo(() => {
    const sum = (key: "outlet_name" | "department") => {
      const m = new Map<string, { gross: number; incomplete: boolean }>();
      for (const r of rows) {
        const k = (r[key] as string) || "Unassigned";
        const cur = m.get(k) ?? { gross: 0, incomplete: false };
        cur.gross += cents(r.gross_pay);
        if (r.has_missing_rate) cur.incomplete = true;
        m.set(k, cur);
      }
      return Array.from(m.entries())
        .map(([name, v]) => ({ name, gross: v.gross / 100, incomplete: v.incomplete }))
        .sort((a, b) => b.gross - a.gross);
    };
    return { byOutlet: sum("outlet_name"), byDept: sum("department") };
  }, [rows]);

  const periodTotal = useMemo(() => rows.reduce((acc, r) => acc + cents(r.gross_pay), 0) / 100, [rows]);

  async function postPeriod() {
    if (!window.confirm(`Lock this period? This moves all 'approved' timecards from ${period.start} to ${period.end} to 'posted'. This cannot be undone here.`)) return;
    setPosting(true);
    try {
      const res = await fetch("/api/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "post_period", start: period.start, end: period.end }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Post failed");
      setToast({ kind: "success", text: `Posted ${data.posted} timecard${data.posted === 1 ? "" : "s"}.` });
      await load();
    } catch (err) {
      setToast({ kind: "error", text: err instanceof Error ? err.message : "Error" });
    } finally {
      setPosting(false);
    }
  }

  function doExport(kind: "earnings" | "hours") {
    const ctx = { periodStart: period.start, periodEnd: period.end, empNumbers, payFrequency: payCycle };
    const csv = kind === "earnings" ? buildEarningsCSV(rows, ctx) : buildHoursCSV(rows, ctx);
    const fn = `manadele_${kind}_${period.start}_to_${period.end}.csv`;
    downloadCSV(fn, csv);
    setToast({ kind: "success", text: `Downloaded ${fn}` });
  }

  // Advisory pre-export gate: NULL regular_rate + approved-but-unposted timecards.
  async function requestExport(kind: "earnings" | "hours") {
    const missingRates = rows.filter((r) => r.regular_rate === null || r.regular_rate === undefined);
    let unposted = 0;
    try {
      const supabase = createClient();
      const { count } = await supabase
        .from("timecards")
        .select("id", { count: "exact", head: true })
        .eq("status", "approved")
        .gte("date", period.start)
        .lte("date", period.end);
      unposted = count ?? 0;
    } catch { /* advisory only */ }

    if (missingRates.length > 0 || unposted > 0) setValidate({ kind, missingRates, unposted });
    else doExport(kind);
  }

  const todayPeriod = currentPeriod(cycle, todayISO());
  const isCurrent = period.start === todayPeriod.start;

  return (
    <div className="max-w-[1280px] page-shell">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Payroll</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>{mounted ? formatPeriod(period) : " "}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn btn-secondary" onClick={() => setPeriod(previousPeriod(period, cycle))}>‹ Prev</button>
          <button className="btn btn-secondary" onClick={() => setPeriod(currentPeriod(cycle, todayISO()))}>Current</button>
          <button className="btn btn-secondary" disabled={isCurrent} onClick={() => setPeriod(nextPeriod(period, cycle))}>Next ›</button>
          <div className="flex items-center gap-1">
            <input type="date" className="input" style={{ width: 150 }} value={period.start}
              onChange={(e) => setPeriod({ ...period, start: e.target.value })} />
            <span style={{ color: "var(--muted)" }}>→</span>
            <input type="date" className="input" style={{ width: 150 }} value={period.end}
              onChange={(e) => setPeriod({ ...period, end: e.target.value })} />
          </div>
          <div className="inline-flex rounded-lg p-1" style={{ background: "var(--surface-2)" }}>
            {(["actual", "prediction"] as Mode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)} className="text-xs px-3 py-1 rounded-md"
                style={{
                  background: mode === m ? "var(--surface)" : "transparent",
                  color: mode === m ? "var(--primary)" : "var(--muted)",
                  fontWeight: mode === m ? 600 : 400, border: "none", cursor: "pointer",
                }}>
                {m === "actual" ? "Final actuals" : "Prediction"}
              </button>
            ))}
          </div>
          <button className="btn btn-secondary" disabled={loading || rows.length === 0} onClick={() => requestExport("earnings")}>Export earnings</button>
          <button className="btn btn-secondary" disabled={loading || rows.length === 0} onClick={() => requestExport("hours")}>Export hours</button>
        </div>
      </div>

      {mode === "prediction" && (
        <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
          Prediction = approved/posted hours so far + scheduled-but-unclocked shifts projected as regular hours (no OT).
        </p>
      )}

      <div className="card overflow-x-auto mb-6">
        <table className="w-full text-sm" style={{ minWidth: 1100 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
              <th className="text-left p-3 font-medium">Employee</th>
              <th className="text-right p-3 font-medium">Reg h / pay</th>
              <th className="text-right p-3 font-medium">OT h / pay</th>
              <th className="text-right p-3 font-medium">Train h / pay</th>
              <th className="text-right p-3 font-medium">PTO h / pay</th>
              <th className="text-right p-3 font-medium">Tip pay</th>
              <th className="text-right p-3 font-medium">Mgr comm</th>
              <th className="text-right p-3 font-medium">Gross</th>
              <th className="text-center p-3 font-medium">TC</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="p-6 text-center" style={{ color: "var(--muted)" }}>Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} className="p-6 text-center" style={{ color: "var(--muted)" }}>No payroll activity in this period.</td></tr>
            )}
            {!loading && rows.map((r) => {
              const isMgr = r.title === "Restaurant Manager";
              const complete = r.scheduled_count > 0 ? r.approved_count >= r.scheduled_count : true;
              return (
                <tr key={r.employee_id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="p-3 align-top">
                    <div className="font-medium">{r.first_name} {r.last_name}</div>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>
                      {[r.job_position, r.outlet_name].filter(Boolean).join(" · ") || "—"}
                    </div>
                    {r.has_missing_rate && (
                      <div className="text-xs mt-1" style={{ color: "var(--amber)" }}>⚠ {r.warnings.join("; ")}</div>
                    )}
                  </td>
                  <td className="p-3 align-top text-right">
                    <div>{hrs(r.regular_hours)}</div>
                    <div style={{ color: r.regular_pay === null ? "var(--amber)" : "var(--primary)" }}>{money(r.regular_pay)}</div>
                  </td>
                  <td className="p-3 align-top text-right">
                    <div>{hrs(r.ot_hours)}</div>
                    <div style={{ color: r.ot_pay === null ? "var(--amber)" : "inherit" }}>{money(r.ot_pay)}</div>
                  </td>
                  <td className="p-3 align-top text-right">
                    <div>{hrs(r.training_hours)}</div>
                    <div style={{ color: r.training_pay === null ? "var(--amber)" : "inherit" }}>{money(r.training_pay)}</div>
                  </td>
                  <td className="p-3 align-top text-right">
                    <div>{hrs(r.pto_hours)}</div>
                    <div style={{ color: r.pto_pay === null ? "var(--amber)" : "inherit" }}>{money(r.pto_pay)}</div>
                  </td>
                  <td className="p-3 align-top text-right">{money(r.tip_pay)}</td>
                  <td className="p-3 align-top text-right">
                    {isMgr && cents(r.manager_amount) > 0 ? money(r.manager_amount) : <span style={{ color: "var(--muted)" }}>—</span>}
                  </td>
                  <td className="p-3 align-top text-right font-semibold" style={{ color: r.gross_pay === null ? "var(--amber)" : "var(--primary)" }}>
                    {money(r.gross_pay)}
                  </td>
                  <td className="p-3 align-top text-center">
                    <span className={`chip ${complete ? "chip-green" : "chip-amber"}`} title="Approved/posted timecards vs scheduled shifts">
                      {r.approved_count}/{r.scheduled_count}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {!loading && rows.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--border)" }}>
                <td className="p-3 font-semibold" colSpan={7}>Period total{anyIncomplete ? " (excludes rows missing rates)" : ""}</td>
                <td className="p-3 text-right font-bold" style={{ color: "var(--primary)" }}>{money(periodTotal)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="card p-5">
          <h3 className="font-semibold mb-3">By outlet</h3>
          {rollups.byOutlet.map((o) => (
            <div key={o.name} className="flex justify-between py-1 text-sm">
              <span>{o.name}{o.incomplete && <span style={{ color: "var(--amber)" }}> ⚠</span>}</span>
              <span className="font-medium" style={{ color: "var(--primary)" }}>{money(o.gross)}</span>
            </div>
          ))}
          {rollups.byOutlet.length === 0 && <p className="text-sm" style={{ color: "var(--muted)" }}>—</p>}
        </div>
        <div className="card p-5">
          <h3 className="font-semibold mb-3">By department</h3>
          {rollups.byDept.map((d) => (
            <div key={d.name} className="flex justify-between py-1 text-sm">
              <span>{d.name}{d.incomplete && <span style={{ color: "var(--amber)" }}> ⚠</span>}</span>
              <span className="font-medium" style={{ color: "var(--primary)" }}>{money(d.gross)}</span>
            </div>
          ))}
          {rollups.byDept.length === 0 && <p className="text-sm" style={{ color: "var(--muted)" }}>—</p>}
        </div>
      </div>

      <div className="flex justify-end">
        <button className="btn btn-primary" disabled={posting || loading} onClick={postPeriod}>
          {posting ? "Posting…" : "Post period (lock approved → posted)"}
        </button>
      </div>

      {/* Advisory pre-export validation modal */}
      <Modal open={!!validate} onClose={() => setValidate(null)} title="Before you export" width={480}>
        {validate && (
          <div className="flex flex-col gap-3 text-sm">
            <p style={{ color: "var(--muted)" }}>
              This is advisory — you can export anyway (e.g. a partial period for review).
            </p>
            {validate.missingRates.length > 0 && (
              <div className="card p-3" style={{ borderColor: "var(--amber)" }}>
                <div style={{ color: "var(--amber)" }}>⚠ {validate.missingRates.length} employee{validate.missingRates.length === 1 ? "" : "s"} missing a regular rate</div>
                <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                  {validate.missingRates.map((r) => `${r.first_name} ${r.last_name}`).join(", ")}
                </div>
                <Link href="/employees" className="text-xs" style={{ color: "var(--primary)" }}>Set rates in Employees →</Link>
              </div>
            )}
            {validate.unposted > 0 && (
              <div className="card p-3" style={{ borderColor: "var(--amber)" }}>
                <div style={{ color: "var(--amber)" }}>⚠ {validate.unposted} timecard{validate.unposted === 1 ? "" : "s"} approved but not posted in this period</div>
                <button className="btn btn-secondary mt-2" style={{ fontSize: 12, padding: "4px 10px" }} disabled={posting}
                  onClick={async () => { await postPeriod(); setValidate(null); }}>
                  {posting ? "Posting…" : "Post period now"}
                </button>
              </div>
            )}
            <div className="flex justify-end gap-2 mt-2">
              <button className="btn btn-secondary" onClick={() => setValidate(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => { const k = validate.kind; setValidate(null); doExport(k); }}>Export anyway</button>
            </div>
          </div>
        )}
      </Modal>

      {toast && (
        <div className="fixed bottom-6 right-6 px-4 py-3 rounded-lg text-sm z-50"
          style={{
            background: toast.kind === "success" ? "var(--primary)" : "var(--danger)",
            color: toast.kind === "success" ? "var(--primary-on)" : "#fff",
          }}>{toast.text}</div>
      )}
    </div>
  );
}

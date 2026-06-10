"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMounted } from "@/lib/useMounted";
import Modal from "@/components/Modal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Timecard = {
  id: string;
  employee_id: string;
  shift_id: string | null;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  break_minutes: number | null;
  training_hours: number | null;
  regular_hours: number | null;
  ot_hours: number | null;
  status: string;
  discrepancy_flag: boolean | null;
  lateness_tier: number | null;
  notes: string | null;
  override_by: string | null;
  override_at: string | null;
  updated_at: string | null;
};

type Row = {
  key: string;
  shift_id: string | null;
  employee_id: string;
  employee_name: string;
  shift_start: string | null;
  shift_end: string | null;
  shift_type: string | null;
  position: string | null;
  outlet_name: string | null;
  is_training: boolean;
  timecard: Timecard | null;
};

type Setup = {
  lateness_tier1_minutes: number;
  lateness_tier2_minutes: number;
  discrepancy_threshold_hours: number;
};

type Employee = { id: string; name: string };
type TimecardEvent = {
  id: string;
  event_type: string;
  value_before: unknown;
  value_after: unknown;
  notes: string | null;
  created_at: string;
};
type Edit = { clock_in: string; clock_out: string; break_minutes: string; training_hours: string };
type Toast = { kind: "success" | "error"; text: string } | null;

// ---------------------------------------------------------------------------
// Helpers (pure wall-clock math — same formulas the approve RPC uses)
// ---------------------------------------------------------------------------
function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}
// "2026-04-20T09:15:00+00:00" -> "09:15"; stored without tz in UTC so this round-trips.
function timeFromISO(iso: string | null): string {
  if (!iso) return "";
  const t = iso.indexOf("T");
  return t >= 0 ? iso.slice(t + 1, t + 6) : "";
}
function hhmmToMin(v: string | null | undefined): number | null {
  if (!v) return null;
  const [h, m] = v.slice(0, 5).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

type Preview = {
  minutesLate: number | null;
  tier: number;
  actualHours: number | null;
  scheduledHours: number | null;
  discrepancy: boolean;
};

function computePreview(
  clockIn: string,
  clockOut: string,
  breakMin: number,
  shiftStart: string | null,
  shiftEnd: string | null,
  setup: Setup | null
): Preview {
  const t1 = setup?.lateness_tier1_minutes ?? 12;
  const t2 = setup?.lateness_tier2_minutes ?? 30;
  const dth = setup?.discrepancy_threshold_hours ?? 2;

  const ci = hhmmToMin(clockIn);
  const co = hhmmToMin(clockOut);
  const ss = hhmmToMin(shiftStart);
  const se = hhmmToMin(shiftEnd);

  let minutesLate: number | null = null;
  let tier = 0;
  if (ci != null && ss != null) {
    minutesLate = Math.max(0, ci - ss);
    if (minutesLate >= t2) tier = 2;
    else if (minutesLate >= t1) tier = 1;
  }

  let actualHours: number | null = null;
  if (ci != null && co != null) {
    let span = co - ci;
    if (span < 0) span += 24 * 60; // overnight
    actualHours = span / 60 - (breakMin || 0) / 60;
    if (actualHours < 0) actualHours = 0;
  }

  let scheduledHours: number | null = null;
  let discrepancy = false;
  if (ss != null && se != null) {
    let span = se - ss;
    if (span <= 0) span += 24 * 60;
    scheduledHours = span / 60;
    if (actualHours != null && Math.abs(actualHours - scheduledHours) > dth) discrepancy = true;
  }

  return { minutesLate, tier, actualHours, scheduledHours, discrepancy };
}

function statusChipClass(status: string) {
  return status === "approved" || status === "posted" ? "chip-green" : "chip-amber";
}

const OVERRIDE_FIELDS = [
  { value: "clock_in", label: "Clock in (HH:MM)" },
  { value: "clock_out", label: "Clock out (HH:MM)" },
  { value: "break_minutes", label: "Break minutes" },
  { value: "training_hours", label: "Training hours" },
  { value: "regular_hours", label: "Regular hours" },
  { value: "ot_hours", label: "OT hours" },
  { value: "lateness_tier", label: "Lateness tier (0/1/2)" },
  { value: "notes", label: "Notes" },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function TimecardsPage() {
  const mounted = useMounted();
  const [date, setDate] = useState(() => toISODate(new Date()));
  const [rows, setRows] = useState<Row[]>([]);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [loading, setLoading] = useState(true);

  // Ad-hoc modal
  const [adhocOpen, setAdhocOpen] = useState(false);
  const [adhoc, setAdhoc] = useState({ employee_id: "", clock_in: "", clock_out: "", break_minutes: "0", notes: "" });

  // Detail drawer
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ timecard: Timecard; events: TimecardEvent[] } | null>(null);

  // Override dialog
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const [ov, setOv] = useState({ field: "clock_in", value: "", note: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const [rRes, sRes, eRes] = await Promise.all([
      fetch(`/api/timecards?date=${date}`).then((r) => r.json()),
      fetch(`/api/setup`).then((r) => r.json()),
      fetch(`/api/employees`).then((r) => r.json()),
    ]);
    const rowList: Row[] = Array.isArray(rRes) ? rRes : [];
    setRows(rowList);
    setSetup(sRes && !sRes.error ? sRes : null);
    setEmployees(Array.isArray(eRes) ? eRes.map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })) : []);

    // seed edit buffers from existing timecards
    const next: Record<string, Edit> = {};
    for (const row of rowList) {
      const tc = row.timecard;
      next[row.key] = {
        clock_in: timeFromISO(tc?.clock_in ?? null),
        clock_out: timeFromISO(tc?.clock_out ?? null),
        break_minutes: String(tc?.break_minutes ?? 0),
        training_hours: String(tc?.training_hours ?? 0),
      };
    }
    setEdits(next);
    setLoading(false);
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  function setEdit(key: string, patch: Partial<Edit>) {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/timecards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  }

  // Save (creating the row if it doesn't exist yet) -> returns timecard id
  async function ensureSaved(row: Row): Promise<string> {
    const e = edits[row.key];
    const saved = (await post({
      action: "save",
      timecard_id: row.timecard?.id ?? null,
      shift_id: row.shift_id,
      employee_id: row.employee_id,
      date,
      clock_in: e.clock_in,
      clock_out: e.clock_out,
      break_minutes: Number(e.break_minutes) || 0,
      training_hours: Number(e.training_hours) || 0,
      notes: row.timecard?.notes ?? null,
    })) as Timecard;
    return saved.id;
  }

  async function withBusy(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      setToast({ kind: "error", text: err instanceof Error ? err.message : "Error" });
    } finally {
      setBusy(null);
    }
  }

  function onSave(row: Row) {
    withBusy(row.key, async () => {
      await ensureSaved(row);
      setToast({ kind: "success", text: "Saved" });
      await load();
    });
  }

  function onReviewed(row: Row) {
    withBusy(row.key, async () => {
      const id = await ensureSaved(row);
      await post({ action: "status", timecard_id: id, to: "reviewed" });
      setToast({ kind: "success", text: "Marked reviewed" });
      await load();
    });
  }

  function onApprove(row: Row) {
    withBusy(row.key, async () => {
      const id = await ensureSaved(row);
      const e = edits[row.key];
      await post({ action: "approve", timecard_id: id, training_hours: Number(e.training_hours) || 0 });
      setToast({ kind: "success", text: "Approved" });
      await load();
    });
  }

  function onPost(row: Row) {
    withBusy(row.key, async () => {
      if (!row.timecard) return;
      await post({ action: "status", timecard_id: row.timecard.id, to: "posted" });
      setToast({ kind: "success", text: "Posted" });
      await load();
    });
  }

  function onAddNote(row: Row) {
    const note = window.prompt("Add a note to this timecard:");
    if (!note || !note.trim()) return;
    withBusy(row.key, async () => {
      const id = await ensureSaved(row);
      await post({ action: "note", timecard_id: id, note: note.trim() });
      setToast({ kind: "success", text: "Note added" });
      if (detailId === id) await openDetail(id);
    });
  }

  function openOverride(row: Row) {
    if (!row.timecard) {
      setToast({ kind: "error", text: "Save the timecard before overriding." });
      return;
    }
    setOverrideFor(row.timecard.id);
    setOv({ field: "clock_in", value: "", note: "" });
  }

  async function submitOverride() {
    if (!overrideFor) return;
    if (!ov.note.trim()) {
      setToast({ kind: "error", text: "A note is required for an override." });
      return;
    }
    setBusy("override");
    try {
      await post({ action: "override", timecard_id: overrideFor, field: ov.field, value: ov.value, note: ov.note.trim() });
      setToast({ kind: "success", text: "Override applied" });
      const id = overrideFor;
      setOverrideFor(null);
      if (detailId === id) await openDetail(id);
      await load();
    } catch (err) {
      setToast({ kind: "error", text: err instanceof Error ? err.message : "Error" });
    } finally {
      setBusy(null);
    }
  }

  async function submitAdhoc() {
    if (!adhoc.employee_id) {
      setToast({ kind: "error", text: "Pick an employee." });
      return;
    }
    setBusy("adhoc");
    try {
      await post({
        action: "adhoc",
        employee_id: adhoc.employee_id,
        date,
        clock_in: adhoc.clock_in,
        clock_out: adhoc.clock_out,
        break_minutes: Number(adhoc.break_minutes) || 0,
        notes: adhoc.notes,
      });
      setToast({ kind: "success", text: "Ad-hoc timecard created" });
      setAdhocOpen(false);
      setAdhoc({ employee_id: "", clock_in: "", clock_out: "", break_minutes: "0", notes: "" });
      await load();
    } catch (err) {
      setToast({ kind: "error", text: err instanceof Error ? err.message : "Error" });
    } finally {
      setBusy(null);
    }
  }

  const openDetail = useCallback(async (id: string) => {
    setDetailId(id);
    setDetail(null);
    const data = await fetch(`/api/timecards/${id}`).then((r) => r.json());
    if (data && !data.error) setDetail(data);
  }, []);

  async function detailStatus(to: string) {
    if (!detail) return;
    setBusy("detail");
    try {
      if (to === "approved") await post({ action: "approve", timecard_id: detail.timecard.id });
      else await post({ action: "status", timecard_id: detail.timecard.id, to });
      await openDetail(detail.timecard.id);
      await load();
    } catch (err) {
      setToast({ kind: "error", text: err instanceof Error ? err.message : "Error" });
    } finally {
      setBusy(null);
    }
  }

  const niceDate = useMemo(() => {
    const d = new Date(date + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }, [date]);

  return (
    <div className="max-w-[1200px]">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Timecards</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>{mounted ? niceDate : " "}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-secondary"
            onClick={() => setDate(toISODate(new Date(new Date(date + "T00:00:00").getTime() - 86400000)))}
          >‹ Prev</button>
          <input type="date" className="input" style={{ width: 170 }} value={date} onChange={(e) => setDate(e.target.value)} />
          <button
            className="btn btn-secondary"
            onClick={() => setDate(toISODate(new Date(new Date(date + "T00:00:00").getTime() + 86400000)))}
          >Next ›</button>
          <button className="btn btn-primary" onClick={() => setAdhocOpen(true)}>+ Ad-hoc timecard</button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
              <th className="text-left p-3 font-medium">Employee</th>
              <th className="text-left p-3 font-medium">Scheduled</th>
              <th className="text-left p-3 font-medium">Clock in</th>
              <th className="text-left p-3 font-medium">Clock out</th>
              <th className="text-left p-3 font-medium">Break</th>
              <th className="text-left p-3 font-medium">Flags</th>
              <th className="text-left p-3 font-medium">Status</th>
              <th className="text-right p-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="p-6 text-center" style={{ color: "var(--muted)" }}>Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="p-6 text-center" style={{ color: "var(--muted)" }}>
                No scheduled shifts for this date. Use “+ Ad-hoc timecard” to add one.
              </td></tr>
            )}
            {!loading && rows.map((row) => {
              const e = edits[row.key] ?? { clock_in: "", clock_out: "", break_minutes: "0", training_hours: "0" };
              const tc = row.timecard;
              const approved = tc?.status === "approved" || tc?.status === "posted";
              const preview = computePreview(e.clock_in, e.clock_out, Number(e.break_minutes) || 0, row.shift_start, row.shift_end, setup);
              const isBusy = busy === row.key;
              return (
                <tr key={row.key} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="p-3 align-top">
                    <div className="font-medium">{row.employee_name || "—"}</div>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>
                      {row.position}{row.is_training && <span className="chip chip-amber ml-1" style={{ fontSize: 10 }}>training</span>}
                    </div>
                  </td>
                  <td className="p-3 align-top">
                    {row.shift_id ? (
                      <div className="text-xs">
                        <div style={{ color: "var(--primary)" }}>
                          {row.shift_start?.slice(0, 5) ?? "?"}–{row.shift_end?.slice(0, 5) ?? "?"}
                        </div>
                        <div style={{ color: "var(--muted)" }}>
                          {row.shift_type}{row.outlet_name ? ` · ${row.outlet_name}` : ""}
                        </div>
                      </div>
                    ) : (
                      <span className="chip chip-muted">ad-hoc</span>
                    )}
                  </td>
                  <td className="p-3 align-top">
                    <input type="time" className="input" style={{ width: 120 }} value={e.clock_in}
                      disabled={approved}
                      onChange={(ev) => setEdit(row.key, { clock_in: ev.target.value })} />
                  </td>
                  <td className="p-3 align-top">
                    <input type="time" className="input" style={{ width: 120 }} value={e.clock_out}
                      disabled={approved}
                      onChange={(ev) => setEdit(row.key, { clock_out: ev.target.value })} />
                  </td>
                  <td className="p-3 align-top">
                    <input type="number" min={0} className="input" style={{ width: 70 }} value={e.break_minutes}
                      disabled={approved}
                      onChange={(ev) => setEdit(row.key, { break_minutes: ev.target.value })} />
                  </td>
                  <td className="p-3 align-top">
                    <div className="flex flex-col gap-1">
                      {preview.tier >= 1 && (
                        <span className="chip chip-amber" title={`${preview.minutesLate} min late`}>
                          ⏰ Tier {preview.tier}
                        </span>
                      )}
                      {preview.discrepancy && (
                        <span className="chip chip-amber" title="Actual vs scheduled hours exceeds threshold">
                          ⚠ Discrepancy
                        </span>
                      )}
                      {approved && (
                        <span className="text-xs" style={{ color: "var(--muted)" }}>
                          reg {tc?.regular_hours ?? 0}h · ot {tc?.ot_hours ?? 0}h
                          {(tc?.training_hours ?? 0) > 0 ? ` · tr ${tc?.training_hours}h` : ""}
                        </span>
                      )}
                      {preview.tier === 0 && !preview.discrepancy && !approved && (
                        <span className="text-xs" style={{ color: "var(--muted)" }}>
                          {preview.actualHours != null ? `${preview.actualHours.toFixed(2)}h` : "—"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 align-top">
                    <span className={`chip ${statusChipClass(tc?.status ?? "pending")}`}>{tc?.status ?? "pending"}</span>
                  </td>
                  <td className="p-3 align-top">
                    <div className="flex items-center justify-end gap-1 flex-wrap">
                      {!approved && (
                        <>
                          <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} disabled={isBusy} onClick={() => onSave(row)}>Save</button>
                          {tc?.status !== "reviewed" && (
                            <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} disabled={isBusy} onClick={() => onReviewed(row)}>Review</button>
                          )}
                          <button className="btn btn-primary" style={{ padding: "4px 10px", fontSize: 12 }} disabled={isBusy} onClick={() => onApprove(row)}>Approve</button>
                        </>
                      )}
                      {tc?.status === "approved" && (
                        <button className="btn btn-primary" style={{ padding: "4px 10px", fontSize: 12 }} disabled={isBusy} onClick={() => onPost(row)}>Post</button>
                      )}
                      <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} disabled={isBusy} onClick={() => openOverride(row)}>Override</button>
                      <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} disabled={isBusy} onClick={() => onAddNote(row)}>Note</button>
                      {tc && (
                        <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => openDetail(tc.id)}>Detail</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Ad-hoc modal */}
      <Modal open={adhocOpen} onClose={() => setAdhocOpen(false)} title="Ad-hoc timecard">
        <div className="flex flex-col gap-3">
          <label className="text-sm">
            <span style={{ color: "var(--muted)" }}>Employee</span>
            <select className="input mt-1" value={adhoc.employee_id} onChange={(e) => setAdhoc({ ...adhoc, employee_id: e.target.value })}>
              <option value="">Select…</option>
              {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span style={{ color: "var(--muted)" }}>Date</span>
            <input type="date" className="input mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-sm">
              <span style={{ color: "var(--muted)" }}>Clock in</span>
              <input type="time" className="input mt-1" value={adhoc.clock_in} onChange={(e) => setAdhoc({ ...adhoc, clock_in: e.target.value })} />
            </label>
            <label className="text-sm">
              <span style={{ color: "var(--muted)" }}>Clock out</span>
              <input type="time" className="input mt-1" value={adhoc.clock_out} onChange={(e) => setAdhoc({ ...adhoc, clock_out: e.target.value })} />
            </label>
            <label className="text-sm">
              <span style={{ color: "var(--muted)" }}>Break (min)</span>
              <input type="number" min={0} className="input mt-1" value={adhoc.break_minutes} onChange={(e) => setAdhoc({ ...adhoc, break_minutes: e.target.value })} />
            </label>
          </div>
          <label className="text-sm">
            <span style={{ color: "var(--muted)" }}>Notes</span>
            <textarea className="input mt-1" rows={2} value={adhoc.notes} onChange={(e) => setAdhoc({ ...adhoc, notes: e.target.value })} />
          </label>
          <div className="flex justify-end gap-2 mt-2">
            <button className="btn btn-secondary" onClick={() => setAdhocOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy === "adhoc"} onClick={submitAdhoc}>Create</button>
          </div>
        </div>
      </Modal>

      {/* Override dialog */}
      <Modal open={!!overrideFor} onClose={() => setOverrideFor(null)} title="Override field" width={440}>
        <div className="flex flex-col gap-3">
          <label className="text-sm">
            <span style={{ color: "var(--muted)" }}>Field</span>
            <select className="input mt-1" value={ov.field} onChange={(e) => setOv({ ...ov, field: e.target.value })}>
              {OVERRIDE_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span style={{ color: "var(--muted)" }}>New value</span>
            <input className="input mt-1" value={ov.value} onChange={(e) => setOv({ ...ov, value: e.target.value })}
              placeholder={ov.field === "clock_in" || ov.field === "clock_out" ? "HH:MM" : ""} />
          </label>
          <label className="text-sm">
            <span style={{ color: "var(--muted)" }}>Note (required)</span>
            <textarea className="input mt-1" rows={3} value={ov.note} onChange={(e) => setOv({ ...ov, note: e.target.value })} />
          </label>
          <div className="flex justify-end gap-2 mt-2">
            <button className="btn btn-secondary" onClick={() => setOverrideFor(null)}>Cancel</button>
            <button className="btn btn-amber" disabled={busy === "override"} onClick={submitOverride}>Apply override</button>
          </div>
        </div>
      </Modal>

      {/* Detail drawer */}
      <Modal open={!!detailId} onClose={() => { setDetailId(null); setDetail(null); }} title="Timecard detail" width={640}>
        {!detail && <p style={{ color: "var(--muted)" }}>Loading…</p>}
        {detail && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Status" value={detail.timecard.status} />
              <Field label="Date" value={detail.timecard.date} />
              <Field label="Clock in" value={timeFromISO(detail.timecard.clock_in) || "—"} />
              <Field label="Clock out" value={timeFromISO(detail.timecard.clock_out) || "—"} />
              <Field label="Break (min)" value={String(detail.timecard.break_minutes ?? 0)} />
              <Field label="Training hrs" value={String(detail.timecard.training_hours ?? 0)} />
              <Field label="Regular hrs" value={String(detail.timecard.regular_hours ?? "—")} />
              <Field label="OT hrs" value={String(detail.timecard.ot_hours ?? "—")} />
              <Field label="Lateness tier" value={String(detail.timecard.lateness_tier ?? 0)} />
              <Field label="Discrepancy" value={detail.timecard.discrepancy_flag ? "yes" : "no"} />
            </div>
            {detail.timecard.override_at && (
              <p className="text-xs" style={{ color: "var(--amber)" }}>
                Last overridden {new Date(detail.timecard.override_at).toLocaleString()}
              </p>
            )}

            <div className="flex gap-2 flex-wrap">
              {detail.timecard.status === "pending" && (
                <button className="btn btn-secondary" disabled={busy === "detail"} onClick={() => detailStatus("reviewed")}>Mark reviewed</button>
              )}
              {(detail.timecard.status === "pending" || detail.timecard.status === "reviewed") && (
                <button className="btn btn-primary" disabled={busy === "detail"} onClick={() => detailStatus("approved")}>Approve</button>
              )}
              {detail.timecard.status === "approved" && (
                <button className="btn btn-primary" disabled={busy === "detail"} onClick={() => detailStatus("posted")}>Post</button>
              )}
              <button className="btn btn-secondary" onClick={() => { setOverrideFor(detail.timecard.id); setOv({ field: "clock_in", value: "", note: "" }); }}>Override</button>
              <button className="btn btn-secondary" onClick={() => {
                const note = window.prompt("Add a note:");
                if (note && note.trim()) {
                  post({ action: "note", timecard_id: detail.timecard.id, note: note.trim() })
                    .then(() => openDetail(detail.timecard.id))
                    .catch((err) => setToast({ kind: "error", text: err.message }));
                }
              }}>Add note</button>
            </div>

            <div>
              <h4 className="font-semibold mb-2">Event log</h4>
              <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
                {detail.events.length === 0 && <p className="text-xs" style={{ color: "var(--muted)" }}>No events.</p>}
                {detail.events.map((ev) => (
                  <div key={ev.id} className="p-2 rounded-md text-xs" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                    <div className="flex justify-between">
                      <span className="chip chip-muted">{ev.event_type}</span>
                      <span style={{ color: "var(--muted)" }}>{new Date(ev.created_at).toLocaleString()}</span>
                    </div>
                    {ev.notes && <div className="mt-1">{ev.notes}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {toast && (
        <div
          className="fixed bottom-6 right-6 px-4 py-3 rounded-lg text-sm z-50"
          style={{
            background: toast.kind === "success" ? "var(--primary)" : "var(--danger)",
            color: toast.kind === "success" ? "var(--primary-on)" : "#fff",
          }}
        >{toast.text}</div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs" style={{ color: "var(--muted)" }}>{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

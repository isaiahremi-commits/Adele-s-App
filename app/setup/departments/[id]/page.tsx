"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  PREDEFINED_ROLES,
  OTHER_OPTION,
  TIP_POOL_MODES,
  tipPoolModeLabel,
  tipPoolModeChipClass,
} from "@/lib/constants";

// PR #28 — Department page: positions catalog + the department's outlets.

type DepartmentRow = { id: string; name: string; type?: string | null };
type CatalogPosition = { id: string; department_id: string; position_name: string };
type OutletCard = {
  id: string;
  name: string;
  tip_pool_mode: string | null;
  position_count: number;
  employee_count: number;
};

export default function DepartmentPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [dept, setDept] = useState<DepartmentRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState("");
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [positions, setPositions] = useState<CatalogPosition[]>([]);
  const [outlets, setOutlets] = useState<OutletCard[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [posForm, setPosForm] = useState<{ role_name: string; other: boolean }>({ role_name: "", other: false });
  const [newOutlet, setNewOutlet] = useState("");
  const [newOutletMode, setNewOutletMode] = useState<string>("pool_daily_all");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [all, pos, outs] = await Promise.all([
      fetch("/api/departments").then((r) => r.json()).catch(() => []),
      fetch(`/api/departments/positions?department_id=${id}`).then((r) => r.json()).catch(() => []),
      fetch(`/api/departments/${id}/outlets`).then((r) => r.json()).catch(() => []),
    ]);
    const d = Array.isArray(all) ? (all as DepartmentRow[]).find((x) => x.id === id) : undefined;
    if (!d) {
      setNotFound(true);
      return;
    }
    setDept(d);
    setName(d.name);
    setPositions(Array.isArray(pos) ? pos : []);
    setOutlets(Array.isArray(outs) ? outs : []);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function saveName(next: string) {
    if (!next.trim() || next.trim() === dept?.name) return;
    setNameMsg(null);
    const res = await fetch("/api/departments/upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: next.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNameMsg(data.error || `Save failed (${res.status})`);
      setName(dept?.name ?? "");
      return;
    }
    setNameMsg("Saved");
    setTimeout(() => setNameMsg(null), 2000);
    load();
  }

  async function deleteDepartment() {
    if (!confirm("Delete this department? It must have no outlets or employees.")) return;
    const res = await fetch(`/api/departments/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || `Delete failed (${res.status})`);
      return;
    }
    router.push("/setup");
  }

  async function addPosition(e: React.FormEvent) {
    e.preventDefault();
    const posName = posForm.role_name.trim();
    if (!posName || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/departments/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department_id: id, position_name: posName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Save failed (${res.status})`);
        return;
      }
      setPosForm({ role_name: "", other: false });
      load();
    } finally {
      setBusy(false);
    }
  }

  async function removePosition(posName: string) {
    setError(null);
    const res = await fetch(
      `/api/departments/positions?department_id=${id}&position_name=${encodeURIComponent(posName)}`,
      { method: "DELETE" }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || `Remove failed (${res.status})`);
      return;
    }
    load();
  }

  async function addOutlet(e: React.FormEvent) {
    e.preventDefault();
    if (!newOutlet.trim() || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/outlets/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department_id: id, name: newOutlet.trim(), tip_pool_mode: newOutletMode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Save failed (${res.status})`);
        return;
      }
      setNewOutlet("");
      setNewOutletMode("pool_daily_all");
      load();
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <div>
        <p className="text-sm mb-3" style={{ color: "var(--muted)" }}>Department not found.</p>
        <Link href="/setup" className="text-sm" style={{ color: "var(--primary)" }}>← Back to Setup</Link>
      </div>
    );
  }
  if (!dept) {
    return <div className="p-6" style={{ color: "var(--muted)" }}>Loading…</div>;
  }

  return (
    <div className="max-w-[1100px] page-shell">
      <button
        onClick={() => router.push("/setup")}
        className="text-sm mb-4"
        style={{ color: "var(--muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        ← Back to Setup
      </button>

      <header className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <label className="text-xs block" style={{ color: "var(--muted)" }}>Department name</label>
          <input
            className="input mt-1 text-lg font-semibold"
            style={{ maxWidth: 420 }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={(e) => saveName(e.target.value)}
          />
          {nameMsg && (
            <span className="text-xs ml-2" style={{ color: nameMsg === "Saved" ? "var(--primary)" : "var(--danger)" }}>
              {nameMsg}
            </span>
          )}
        </div>
        <button className="text-xs mt-5" onClick={deleteDepartment} style={{ color: "var(--danger)" }}>
          Delete department
        </button>
      </header>

      {error && (
        <div className="text-sm mb-4 p-2 rounded-md" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      <section className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-1">Positions</h2>
        <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
          The roles this department offers. Assign them to outlets (with points) on each outlet&apos;s page.
        </p>
        <form onSubmit={addPosition} className="flex gap-2 mb-4 flex-wrap">
          <select
            className="input"
            style={{ maxWidth: 200 }}
            value={posForm.other ? OTHER_OPTION : posForm.role_name}
            onChange={(e) => {
              const v = e.target.value;
              if (v === OTHER_OPTION) setPosForm({ role_name: "", other: true });
              else setPosForm({ role_name: v, other: false });
            }}
          >
            <option value="">Select role…</option>
            {PREDEFINED_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            <option value={OTHER_OPTION}>{OTHER_OPTION}</option>
          </select>
          {posForm.other && (
            <input
              className="input"
              placeholder="Custom role"
              value={posForm.role_name}
              onChange={(e) => setPosForm({ ...posForm, role_name: e.target.value })}
            />
          )}
          <button className="btn btn-secondary" type="submit" disabled={busy}>Add position</button>
        </form>
        <div className="flex flex-wrap gap-2">
          {positions.length === 0 && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>No positions yet.</span>
          )}
          {positions.map((p) => (
            <span key={p.id} className="chip chip-green flex items-center gap-2">
              {p.position_name}
              <button
                onClick={() => removePosition(p.position_name)}
                title="Remove from this department (must be unassigned from all outlets first)"
                style={{ color: "var(--danger)" }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold mb-1">Outlets</h2>
        <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
          Click an outlet to set its tip sheet type, positions, and team members.
        </p>
        <form onSubmit={addOutlet} className="flex gap-2 mb-4 flex-wrap">
          <input
            className="input flex-1 min-w-[200px]"
            placeholder="Outlet name"
            value={newOutlet}
            onChange={(e) => setNewOutlet(e.target.value)}
          />
          <select
            className="input"
            style={{ maxWidth: 220 }}
            value={newOutletMode}
            onChange={(e) => setNewOutletMode(e.target.value)}
          >
            {TIP_POOL_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <button className="btn btn-primary" type="submit" disabled={busy}>+ Add outlet</button>
        </form>
        {outlets.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>No outlets in this department yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {outlets.map((o) => (
              <Link
                key={o.id}
                href={`/setup/outlets/${o.id}`}
                className="p-4 rounded-lg block"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "inherit", textDecoration: "none" }}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-semibold">{o.name}</span>
                  <span style={{ color: "var(--muted)" }}>›</span>
                </div>
                <span className={`chip ${tipPoolModeChipClass(o.tip_pool_mode)}`} style={{ fontSize: 10 }}>
                  {tipPoolModeLabel(o.tip_pool_mode)}
                </span>
                <div className="text-xs mt-2" style={{ color: "var(--muted)" }}>
                  {o.position_count} position{o.position_count === 1 ? "" : "s"} · {o.employee_count} team member{o.employee_count === 1 ? "" : "s"}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

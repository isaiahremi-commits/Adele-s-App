"use client";
import { useCallback, useEffect, useState } from "react";
import TimeWindowFilter from "@/components/TimeWindowFilter";
import type { Window } from "@/lib/timeWindow";

type Swap = {
  id: string; shift_id: string; date: string | null; shift_type: string | null; outlet_name: string | null;
  original_name: string; new_name: string; status: string; swapped_by_name: string | null; notes: string | null; created_at: string;
};

export default function SwapsPage() {
  const [tab, setTab] = useState<"all" | "pending">("all");
  const [win, setWin] = useState<Window | null>(null);
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async (t: "all" | "pending", w: Window) => {
    setLoading(true);
    const statusQ = t === "pending" ? "&status=pending" : "";
    const res = await fetch(`/api/swaps?start=${w.start}&end=${w.end}${statusQ}`).then((r) => r.json()).catch(() => []);
    setSwaps(Array.isArray(res) ? res : []); setLoading(false);
  }, []);

  useEffect(() => { if (win) load(tab, win); }, [tab, win, load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  async function act(id: string, action: "accept" | "cancel") {
    setBusy(id);
    try {
      const res = await fetch(`/api/swaps/${id}/${action}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed");
      setToast({ kind: "success", text: action === "accept" ? "Swap accepted." : "Swap cancelled." });
      if (win) await load(tab, win);
    } catch (e) { setToast({ kind: "error", text: e instanceof Error ? e.message : "Error" }); }
    finally { setBusy(null); }
  }

  return (
    <div className="max-w-[1100px]">
      <h1 className="text-2xl font-bold mb-4">Swaps</h1>
      <div className="inline-flex rounded-lg p-1 mb-4" style={{ background: "var(--surface-2)" }}>
        {(["all", "pending"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className="text-xs px-3 py-1 rounded-md"
            style={{ background: tab === t ? "var(--surface)" : "transparent", color: tab === t ? "var(--primary)" : "var(--muted)", fontWeight: tab === t ? 600 : 400, border: "none", cursor: "pointer" }}>
            {t === "all" ? "All" : "Pending"}
          </button>
        ))}
      </div>

      <TimeWindowFilter storageKey="swaps_window" onChange={setWin} />

      <div className="card overflow-x-auto">
        {loading ? <div className="p-6 text-center" style={{ color: "var(--muted)" }}>Loading…</div> : (
          <table className="w-full text-sm">
            <thead><tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
              <th className="text-left p-3">Date</th><th className="text-left p-3">Shift</th>
              <th className="text-left p-3">Original → New</th><th className="text-left p-3">Status</th>
              <th className="text-left p-3">By</th><th className="text-left p-3">Notes</th><th className="text-right p-3">Actions</th>
            </tr></thead>
            <tbody>
              {swaps.length === 0 && <tr><td colSpan={7} className="p-6 text-center" style={{ color: "var(--muted)" }}>No swaps in this window.</td></tr>}
              {swaps.map((s) => (
                <tr key={s.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="p-3">{s.date ?? "—"}</td>
                  <td className="p-3">{s.shift_type ?? "—"}{s.outlet_name ? ` · ${s.outlet_name}` : ""}</td>
                  <td className="p-3">{s.original_name} → {s.new_name}</td>
                  <td className="p-3"><span className={`chip ${s.status === "completed" ? "chip-green" : "chip-amber"}`}>{s.status}</span></td>
                  <td className="p-3" style={{ color: "var(--muted)" }}>{s.swapped_by_name ?? "—"}</td>
                  <td className="p-3" style={{ color: "var(--muted)" }}>{s.notes ?? "—"}</td>
                  <td className="p-3 text-right">
                    {s.status === "pending" && (
                      <div className="flex gap-1 justify-end">
                        <button className="btn btn-primary" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy === s.id} onClick={() => act(s.id, "accept")}>Accept</button>
                        <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy === s.id} onClick={() => act(s.id, "cancel")}>Cancel</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 px-4 py-3 rounded-lg text-sm z-50"
          style={{ background: toast.kind === "success" ? "var(--primary)" : "var(--danger)", color: toast.kind === "success" ? "var(--primary-on)" : "#fff" }}>{toast.text}</div>
      )}
    </div>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { getWindow, todayISO, type Window, type WindowKind } from "@/lib/timeWindow";

const KINDS: { kind: WindowKind; label: string }[] = [
  { kind: "weekly", label: "Weekly" },
  { kind: "biweekly", label: "Bi-weekly" },
  { kind: "monthly", label: "Monthly" },
  { kind: "quarterly", label: "Quarterly" },
  { kind: "yearly", label: "Yearly" },
  { kind: "custom", label: "Custom" },
];

export default function TimeWindowFilter({
  storageKey,
  onChange,
}: {
  storageKey: string;
  onChange: (w: Window) => void;
}) {
  const [kind, setKind] = useState<WindowKind>("biweekly");
  const [payCycle, setPayCycle] = useState<string>("biweekly");
  const [customStart, setCustomStart] = useState(todayISO());
  const [customEnd, setCustomEnd] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Load persisted kind + setup cycle on mount.
  useEffect(() => {
    const saved = (typeof window !== "undefined" && localStorage.getItem(storageKey)) as WindowKind | null;
    if (saved) setKind(saved);
    fetch("/api/setup").then((r) => r.json()).then((s) => { if (s?.pay_cycle) setPayCycle(s.pay_cycle); }).catch(() => {});
  }, [storageKey]);

  // Recompute + emit whenever inputs change.
  useEffect(() => {
    try {
      const w = getWindow(kind, todayISO(), { customStart, customEnd, payCycle });
      setError(null);
      onChangeRef.current(w);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid range");
    }
  }, [kind, customStart, customEnd, payCycle]);

  function pick(k: WindowKind) {
    setKind(k);
    if (typeof window !== "undefined") localStorage.setItem(storageKey, k);
  }

  return (
    <div className="flex flex-col gap-2 mb-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg p-1" style={{ background: "var(--surface-2)" }}>
          {KINDS.map((k) => (
            <button key={k.kind} onClick={() => pick(k.kind)} className="text-xs px-3 py-1 rounded-md"
              style={{
                background: kind === k.kind ? "var(--surface)" : "transparent",
                color: kind === k.kind ? "var(--primary)" : "var(--muted)",
                fontWeight: kind === k.kind ? 600 : 400, border: "none", cursor: "pointer",
              }}>
              {k.label}
            </button>
          ))}
        </div>
        {kind === "custom" && (
          <div className="flex items-center gap-1">
            <input type="date" className="input" style={{ width: 150 }} value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            <span style={{ color: "var(--muted)" }}>→</span>
            <input type="date" className="input" style={{ width: 150 }} value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </div>
        )}
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          {(() => { try { return getWindow(kind, todayISO(), { customStart, customEnd, payCycle }).label; } catch { return ""; } })()}
        </span>
      </div>
      {error && <span className="text-xs" style={{ color: "var(--danger)" }}>{error}</span>}
    </div>
  );
}

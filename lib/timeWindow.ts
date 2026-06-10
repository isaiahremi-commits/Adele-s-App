// Shared time-window math for the Tier 2 reports + swaps pages.
// Pure functions, no React. Returns ISO date strings (YYYY-MM-DD) rather than
// Date objects so the values pass straight into API params without timezone
// drift. Biweekly reuses lib/payroll.ts (Saturday-anchored, matches the pay
// engine) — period math is NOT duplicated here.

import { periodFor, cycleLength } from "@/lib/payroll";

export type WindowKind = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "custom";
export type Window = { start: string; end: string; label: string; kind: WindowKind };

function toUTC(iso: string): Date {
  return new Date(iso + "T00:00:00Z");
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(isoDate: string, n: number): string {
  const d = toUTC(isoDate);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
function fmt(isoDate: string): string {
  return toUTC(isoDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// Weekly = ISO week (Monday → Sunday), consistent with the 40h/OT week rule.
function isoWeek(anchorIso: string): { start: string; end: string } {
  const d = toUTC(anchorIso);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const backToMonday = (day + 6) % 7;
  const start = addDays(anchorIso, -backToMonday);
  return { start, end: addDays(start, 6) };
}

function month(anchorIso: string): { start: string; end: string } {
  const d = toUTC(anchorIso);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const start = iso(new Date(Date.UTC(y, m, 1)));
  const end = iso(new Date(Date.UTC(y, m + 1, 0)));
  return { start, end };
}

function quarter(anchorIso: string): { start: string; end: string } {
  const d = toUTC(anchorIso);
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3); // 0..3
  const start = iso(new Date(Date.UTC(y, q * 3, 1)));
  const end = iso(new Date(Date.UTC(y, q * 3 + 3, 0)));
  return { start, end };
}

function year(anchorIso: string): { start: string; end: string } {
  const y = toUTC(anchorIso).getUTCFullYear();
  return { start: iso(new Date(Date.UTC(y, 0, 1))), end: iso(new Date(Date.UTC(y, 11, 31))) };
}

// anchorIso defaults to today; payCycle drives the biweekly cycle length.
export function getWindow(
  kind: WindowKind,
  anchorIso: string,
  opts?: { customStart?: string; customEnd?: string; payCycle?: string }
): Window {
  let start: string, end: string, label: string;
  switch (kind) {
    case "weekly": {
      const w = isoWeek(anchorIso); start = w.start; end = w.end;
      label = `Week of ${fmt(start)}`; break;
    }
    case "biweekly": {
      const p = periodFor(anchorIso, cycleLength(opts?.payCycle ?? "biweekly"));
      start = p.start; end = p.end; label = `Pay period ${fmt(start)} – ${fmt(end)}`; break;
    }
    case "monthly": {
      const m = month(anchorIso); start = m.start; end = m.end;
      label = toUTC(start).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }); break;
    }
    case "quarterly": {
      const q = quarter(anchorIso); start = q.start; end = q.end;
      const qn = Math.floor(toUTC(start).getUTCMonth() / 3) + 1;
      label = `Q${qn} ${toUTC(start).getUTCFullYear()}`; break;
    }
    case "yearly": {
      const y = year(anchorIso); start = y.start; end = y.end;
      label = String(toUTC(start).getUTCFullYear()); break;
    }
    case "custom": {
      start = opts?.customStart ?? anchorIso;
      end = opts?.customEnd ?? anchorIso;
      if (end < start) throw new Error("End date must be on or after start date");
      label = `${fmt(start)} – ${fmt(end)}`; break;
    }
  }
  return { start, end, label, kind };
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

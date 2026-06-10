// Pay-period math for the Manadele pay engine.
//
// Boundaries are derived from setup.pay_cycle ('weekly' | 'biweekly') and
// setup.period_start_day ('saturday'). Periods are anchored on the Saturday
// 2026-01-03 (the first Saturday of 2026) so that both weekly and biweekly
// cycles start on the configured weekday and biweekly cycles alternate
// deterministically. Passing explicit start/end downstream keeps the SQL
// engine anchor-agnostic.

export const PERIOD_ANCHOR = "2026-01-03"; // Saturday, week-1 start

export type Period = { start: string; end: string };

function toUTCDate(iso: string): Date {
  return new Date(iso + "T00:00:00Z");
}
function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(iso: string, n: number): string {
  const d = toUTCDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}
function daysBetween(aIso: string, bIso: string): number {
  return Math.floor((toUTCDate(bIso).getTime() - toUTCDate(aIso).getTime()) / 86400000);
}

export function cycleLength(payCycle: string | null | undefined): number {
  return (payCycle ?? "biweekly").toLowerCase() === "weekly" ? 7 : 14;
}

// The period containing `dateIso` for the given cycle length.
export function periodFor(dateIso: string, cycleLen: number): Period {
  const diff = daysBetween(PERIOD_ANCHOR, dateIso);
  const idx = Math.floor(diff / cycleLen);
  const start = addDays(PERIOD_ANCHOR, idx * cycleLen);
  const end = addDays(start, cycleLen - 1);
  return { start, end };
}

export function currentPeriod(cycleLen: number, todayIso: string): Period {
  return periodFor(todayIso, cycleLen);
}

export function previousPeriod(period: Period, cycleLen: number): Period {
  const start = addDays(period.start, -cycleLen);
  const end = addDays(start, cycleLen - 1);
  return { start, end };
}

export function nextPeriod(period: Period, cycleLen: number): Period {
  const start = addDays(period.start, cycleLen);
  const end = addDays(start, cycleLen - 1);
  return { start, end };
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatPeriod(p: Period): string {
  const s = toUTCDate(p.start);
  const e = toUTCDate(p.end);
  const opt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  return `${s.toLocaleDateString(undefined, opt)} – ${e.toLocaleDateString(undefined, { ...opt, year: "numeric" })}`;
}

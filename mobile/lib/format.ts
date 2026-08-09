// Shared display formatters — the single source of truth for how money,
// hours, dates, and times render anywhere in the app (PR #14 conventions):
//   money   → $1,234.56   (grouped, always 2 decimals)
//   hours   → 7.42h       (always 2 decimals, lowercase h)
//   dates   → Aug 9, 2026 (display; ISO stays in inputs/APIs)
//   times   → 9:00am      (12-hour, lowercase am/pm)
// Screens must not hand-roll these — import from here so the formats can
// never drift apart again.

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** $1,234.56 — grouped thousands, always two decimals. */
export function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "$0.00";
  const sign = n < 0 ? "-" : "";
  return (
    sign +
    "$" +
    Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** 7.42h — always two decimals, lowercase h. */
export function hoursFmt(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0.00h";
  return `${n.toFixed(2)}h`;
}

/** Parse "YYYY-MM-DD" (or a full ISO timestamp) as a LOCAL date — never via
 * bare `new Date("YYYY-MM-DD")`, which reads as UTC midnight and shifts a
 * calendar day west of Greenwich. */
export function parseDay(iso: string): Date {
  return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
}

/** Aug 9, 2026 — the standard display date. */
export function dateFmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parseDay(iso);
  if (isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Mon, Aug 9 — for schedule rows, where the weekday carries the meaning
 * and the year is always the current one. */
export function dayDateFmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parseDay(iso);
  if (isNaN(d.getTime())) return "—";
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Aug 9 – Aug 22, 2026 (same year) / Dec 28, 2025 – Jan 3, 2026. */
export function rangeFmt(startIso: string, endIso: string): string {
  const s = parseDay(startIso);
  const e = parseDay(endIso);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return "—";
  const sPart = `${MONTHS[s.getMonth()]} ${s.getDate()}`;
  const ePart = `${MONTHS[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
  return s.getFullYear() === e.getFullYear()
    ? `${sPart} – ${ePart}`
    : `${sPart}, ${s.getFullYear()} – ${ePart}`;
}

/** 9:00am / 12:30pm from a Postgres time string ("09:00", "09:00:00") —
 * 12-hour, lowercase, no space. */
export function timeFmt(t: string | null | undefined): string {
  if (!t) return "—";
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h24 = Number(m[1]);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m[2]}${h24 < 12 ? "am" : "pm"}`;
}

/** "head server" → "Head Server" — positions are stored lowercase. */
export function titleCase(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1));
}

/** 9:00am from a timestamp (e.g. clock-in/out instants). */
export function timeFromTimestamp(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${h12}:${mm}${h24 < 12 ? "am" : "pm"}`;
}

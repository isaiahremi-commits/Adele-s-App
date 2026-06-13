// Shared display helpers (Adèle day-2 feedback).

// Item 12: render a time as 12-hour AM/PM, e.g. "17:00" -> "5:00 PM".
// Accepts "HH:MM" / "HH:MM:SS" or an ISO timestamp (slices the time-of-day).
export function format12h(value: string | null | undefined): string {
  if (!value) return "";
  let hhmm = value;
  const t = value.indexOf("T");
  if (t >= 0) hhmm = value.slice(t + 1, t + 6); // ISO timestamp -> wall time
  const [hStr, mStr] = hhmm.slice(0, 5).split(":");
  const h = Number(hStr), m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return value;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

// Item 15: title-case a position/role for display only (stored value stays
// lowercase per Migration 002). "bar back" -> "Bar Back".
export function titleCase(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

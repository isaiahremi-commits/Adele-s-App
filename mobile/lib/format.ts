// Display helpers. titleCase mirrors the web app's lib/format.ts exactly —
// positions are stored lowercase (Migration 002) or in mixed legacy casing,
// and BOTH apps must render them the same way. Display-only; never write a
// title-cased value back.

/** "bar back" -> "Bar Back"; already-cased words keep their tails ("Barback"
 * stays "Barback"). Null-safe. */
export function titleCase(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * 12-hour clock display (PR #18 — Adèle: no 24-hour times anywhere).
 * Accepts "HH:MM" / "HH:MM:SS" wall-clock strings (how shifts store times)
 * or an ISO timestamp (slices the time-of-day). "17:00" -> "5:00 pm".
 * Unparseable/empty -> "—", matching the old formatShiftTime fallback.
 */
export function formatTime12(value: string | null | undefined): string {
  if (!value) return "—";
  let hhmm = value;
  const t = value.indexOf("T");
  if (t >= 0) hhmm = value.slice(t + 1, t + 6);
  const [hStr, mStr] = hhmm.slice(0, 5).split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return "—";
  const period = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

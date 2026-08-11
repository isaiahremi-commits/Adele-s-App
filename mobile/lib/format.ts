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

// Shared, app-wide option lists (pilot feedback day 1).

// Pre-defined outlet roles / positions (case-sensitive lowercase per Adèle).
// "Other" reveals a free-text field at the call site.
export const PREDEFINED_ROLES = [
  "bar back",
  "bartender",
  "busser",
  "host",
  "server",
  "cocktail server",
  "prep",
  "barista",
  "polisher",
  "runner",
] as const;

export const SHIRT_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL"] as const;

export const OTHER_OPTION = "Other";

// PR #28: the four tip sheet types (outlets.tip_pool_mode post-027).
export const TIP_POOL_MODES = [
  { value: "pool_daily", label: "Pool (daily)" },
  { value: "pool_weekly", label: "Pool (weekly)" },
  { value: "individual_daily", label: "Individual (daily)" },
  { value: "no_tips", label: "No tips repartition" },
] as const;

export function tipPoolModeLabel(mode: string | null | undefined): string {
  if (!mode) return "Not set";
  // Legacy values may linger until Migration 027 is applied.
  if (mode === "pool") return "Pool (daily)";
  if (mode === "individual") return "Individual (daily)";
  return TIP_POOL_MODES.find((m) => m.value === mode)?.label ?? mode;
}

export function tipPoolModeChipClass(mode: string | null | undefined): string {
  if (!mode) return "chip-muted";
  if (mode === "no_tips") return "chip-muted";
  if (mode.startsWith("individual")) return "chip-amber";
  return "chip-green";
}

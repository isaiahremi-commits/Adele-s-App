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

// PR #29: the five tip sheet types (outlets.tip_pool_mode post-028) —
// pool_daily split into all-shifts-together vs per-shift pools (Aug 21).
export const TIP_POOL_MODES = [
  { value: "pool_daily_all", label: "Pool (daily — all shifts together)" },
  { value: "pool_daily_separate", label: "Pool (daily — separate per shift)" },
  { value: "pool_weekly", label: "Pool (weekly)" },
  { value: "individual_daily", label: "Individual (daily)" },
  { value: "no_tips", label: "No tips repartition" },
] as const;

export function tipPoolModeLabel(mode: string | null | undefined): string {
  if (!mode) return "Not set";
  // Legacy values may linger until Migrations 027/028 are applied.
  if (mode === "pool" || mode === "pool_daily") return "Pool (daily — all shifts together)";
  if (mode === "individual") return "Individual (daily)";
  return TIP_POOL_MODES.find((m) => m.value === mode)?.label ?? mode;
}

export function tipPoolModeChipClass(mode: string | null | undefined): string {
  if (!mode) return "chip-muted";
  if (mode === "no_tips") return "chip-muted";
  if (mode.startsWith("individual")) return "chip-amber";
  return "chip-green";
}

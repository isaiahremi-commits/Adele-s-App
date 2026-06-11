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

// Manadele brand system — from Manadele_Brand Guidelines_V1 (Aug 2026).
//
// PR #27: hexes are no longer estimates — they're extracted from the final
// logo SVGs Adèle sent (each colorway carries its literal fill), closing
// PR #24's "confirm when real codes arrive" flag. Keep this file the single
// source of truth: mobile reads it directly (mobile/lib/theme.ts); the web
// palette in app/globals.css mirrors it and must be updated in lockstep.

export const brand = {
  braunviehMilk: "#F8F7EA", // cream background
  swissChocolate: "#382020", // deep brown text
  apricot: "#F5855F", // primary CTA / accent
  gruyere: "#F8DC89", // tertiary yellow (warning fills)
  berries: "#A7B7DE", // tertiary periwinkle (informational fills)
  pear: "#D2D276", // secondary green (success fills)
} as const;

// Semantic aliases (the app-facing vocabulary).
export const semantic = {
  background: brand.braunviehMilk,
  surface: "#FFFFFF", // white cards on cream
  text: brand.swissChocolate,
  textMuted: "#38202080", // 50% swiss chocolate — subtitles
  primary: brand.apricot,
  primaryText: "#FFFFFF", // white on apricot buttons
  secondary: brand.pear,
  border: "#38202015", // 8% swiss chocolate — hairlines
  error: "#C24545",
  warning: brand.gruyere,
} as const;

// Font family stems. Concrete per-platform names live in mobile/lib/theme.ts
// (expo-google-fonts registered names) and app/layout.tsx (next/font vars).
export const fonts = {
  primary: "ElmsSans",
  secondary: "CrimsonText",
} as const;

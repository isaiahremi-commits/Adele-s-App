// Manadele brand system — from Manadele_Brand Guidelines_V1 (Aug 2026).
//
// NOTE: the brand book left "Hex Code" placeholders under every swatch, so
// these values are visual estimates — Adèle confirms/adjusts after seeing
// them on-device. Keep this file the single source of truth: mobile reads it
// directly (mobile/lib/theme.ts); the web palette in app/globals.css mirrors
// it and must be updated in lockstep.

export const brand = {
  braunviehMilk: "#F7F2E1", // cream background
  swissChocolate: "#3A1F1A", // deep brown text
  apricot: "#E8825A", // primary CTA / accent
  gruyere: "#F0D677", // tertiary yellow (warning fills)
  berries: "#A5B0DE", // tertiary periwinkle (informational fills)
  pear: "#C4C866", // secondary green (success fills)
} as const;

// Semantic aliases (the app-facing vocabulary).
export const semantic = {
  background: brand.braunviehMilk,
  surface: "#FFFFFF", // white cards on cream
  text: brand.swissChocolate,
  textMuted: "#3A1F1A80", // 50% swiss chocolate — subtitles
  primary: brand.apricot,
  primaryText: "#FFFFFF", // white on apricot buttons
  secondary: brand.pear,
  border: "#3A1F1A15", // 8% swiss chocolate — hairlines
  error: "#C24545",
  warning: brand.gruyere,
} as const;

// Font family stems. Concrete per-platform names live in mobile/lib/theme.ts
// (expo-google-fonts registered names) and app/layout.tsx (next/font vars).
export const fonts = {
  primary: "ElmsSans",
  secondary: "CrimsonText",
} as const;

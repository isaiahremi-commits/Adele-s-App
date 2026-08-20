// Manadele brand palette — sourced from shared/theme.ts (brand book V1).
// Hex values are visual estimates (the brand book has no explicit codes);
// Adèle confirms on-device.
import type { TextStyle } from "react-native";
import { brand, semantic } from "../../shared/theme";

export const colors = {
  background: semantic.background,
  foreground: semantic.text,
  muted: semantic.textMuted, // 50% swiss chocolate
  mutedStrong: "#38202099", // 60% — inactive tab tint
  primary: semantic.primary, // apricot
  primaryDim: "#C9663F", // darker apricot — active-chip text, pressed
  primaryOn: semantic.primaryText,
  primarySoft: "rgba(245, 133, 95, 0.14)", // active chip / toggle fill
  amber: "#8A6A15", // deep gruyère — legible warning text on cream
  warningSoft: "rgba(248, 220, 137, 0.32)", // gruyère fill for banners/pills
  warningBorder: "rgba(138, 106, 21, 0.4)",
  success: semantic.secondary, // pear
  successSoft: "rgba(210, 210, 118, 0.3)", // pear fill — approved/posted
  successText: "#6F7423", // darkened pear — legible on cream
  infoSoft: "rgba(167, 183, 222, 0.28)", // berries fill — informational pills
  infoText: "#4A5486", // darkened berries
  danger: semantic.error,
  dangerSoft: "rgba(194, 69, 69, 0.09)",
  dangerBorder: "rgba(194, 69, 69, 0.42)",
  neutralSoft: "rgba(56, 32, 32, 0.1)", // canceled/dimmed chips
  card: semantic.surface,
  border: semantic.border, // 8% swiss chocolate hairline
  scrim: "rgba(56, 32, 32, 0.45)", // warm modal scrim
  shadow: brand.swissChocolate,
};

// Registered expo-google-fonts family names (loaded in App.tsx). Custom fonts
// don't synthesize weights on native, so each weight is its own family.
export const fontFamilies = {
  regular: "ElmsSans_400Regular",
  medium: "ElmsSans_500Medium",
  semibold: "ElmsSans_600SemiBold",
  bold: "ElmsSans_700Bold",
  serif: "CrimsonText_400Regular",
  serifItalic: "CrimsonText_400Regular_Italic",
} as const;

// Maps a style's fontWeight to the matching Elms Sans family. Used by
// components/Text.tsx so existing `fontWeight` declarations keep working.
export function fontForWeight(weight?: TextStyle["fontWeight"]): string {
  switch (String(weight ?? "400")) {
    case "500":
      return fontFamilies.medium;
    case "600":
      return fontFamilies.semibold;
    case "700":
    case "800":
    case "900":
    case "bold":
      return fontFamilies.bold;
    default:
      return fontFamilies.regular;
  }
}

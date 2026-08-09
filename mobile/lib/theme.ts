// Mirrors the web app's light palette (app/globals.css).
export const colors = {
  background: "#f8f9fa",
  foreground: "#1a1a1a",
  muted: "#6b7280",
  primary: "#2db87a",
  primaryDim: "#229966",
  primaryOn: "#ffffff",
  amber: "#d97706",
  card: "#ffffff",
  border: "#e5e7eb",
  // PR #14 tokens — these existed as scattered hex/rgba literals before;
  // every screen now pulls them from here so tints can't drift.
  danger: "#dc2626",
  primarySoft: "rgba(45, 184, 122, 0.12)",
  amberSoft: "rgba(217, 119, 6, 0.12)",
  backdrop: "rgba(0, 0, 0, 0.4)",
};

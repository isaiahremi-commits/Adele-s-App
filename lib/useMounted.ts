"use client";
import { useEffect, useState } from "react";

// Returns false during SSR + the first client render, true after mount.
// Use to gate values that legitimately differ between server and client
// (current date/time, locale-formatted strings) so they don't trigger
// hydration mismatches — the server renders a stable placeholder, the client
// fills in the real value after hydration.
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

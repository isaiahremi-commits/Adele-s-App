"use client";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// PR #15 Bug 1: nothing kept the auth session fresh while a page sat open —
// the middleware only runs on navigations (and skips /api), and no browser
// Supabase client existed outside /login. After ~1 hour on /employees the
// access token expired and the admin API calls started failing 401 until a
// re-login. Mounting the browser client app-wide starts supabase-js's
// auto-refresh timer, which rotates the cookie in the background for as long
// as any tab is open — API routes then always receive a live token.
export default function SessionKeepalive() {
  useEffect(() => {
    const supabase = createClient();
    // Subscribing keeps the client (and its refresh timer) referenced for
    // the lifetime of the tab; the callback itself has nothing to do.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {});
    return () => subscription.unsubscribe();
  }, []);
  return null;
}

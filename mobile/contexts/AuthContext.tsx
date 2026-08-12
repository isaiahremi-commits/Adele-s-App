import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import type { Session, User } from "@supabase/supabase-js";
import { TOS_CURRENT_VERSION } from "../../shared/tos";
import { showToast } from "../components/Toast";
import {
  KICKED_MESSAGE,
  checkDeviceSession,
  registerDeviceSession,
  unregisterDeviceSession,
} from "../lib/deviceSession";
import { supabase } from "../lib/supabase";
import { getMyTippedStatus } from "../lib/tips";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  /** True while the persisted session is being restored on app boot. */
  loading: boolean;
  /** Gate: admin set user_metadata.must_change_password on this account. */
  mustChangePassword: boolean;
  /** Gate: user hasn't accepted the current T&C version yet. */
  needsTosAcceptance: boolean;
  /**
   * Tip-roster status (employee_is_tipped; pay-type driven since 019),
   * fetched once per signed-in user. False hides every tip surface
   * (managers + salaried employees); defaults to true until known and stays
   * true pre-migration, so nothing regresses before it is applied.
   */
  isTipped: boolean;
  /**
   * Gate: linked employee whose employees.has_completed_self_onboarding is
   * false (migration 019) — App.tsx routes them to SelfOnboardingScreen
   * after the T&C gate. Fail-open false (unlinked, pre-018 RLS, pre-019
   * column, transient errors) so nobody gets stuck at a gate that can't
   * clear.
   */
  selfOnboardingNeeded: boolean;
  /** Re-check the flag (call after employee_self_onboard succeeds). */
  refreshSelfOnboarding: () => Promise<void>;
  /**
   * Termination grace period (PR #20): set when the linked employees row
   * carries a termination_date. daysLeft counts down the 30-day view-only
   * window (clamped at 0). The app renders read-only surfaces while set;
   * the daily lockout cron bans auth after day 30.
   */
  terminated: { date: string; daysLeft: number } | null;
  /**
   * Tenant from user_metadata.tenant_id. RLS scopes every query by it
   * server-side; null means the account was misprovisioned (App.tsx shows the
   * "No tenant assigned" screen).
   */
  tenantId: string | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isTipped, setIsTipped] = useState(true);

  const [selfOnboardingNeeded, setSelfOnboardingNeeded] = useState(false);
  const [terminatedOn, setTerminatedOn] = useState<string | null>(null);

  // Tip-roster status: once per signed-in user (not per token refresh —
  // pay-type changes are rare and a fresh sign-in or app restart refetches).
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!userId) {
      setIsTipped(true);
      return;
    }
    let cancelled = false;
    getMyTippedStatus().then((v) => {
      if (!cancelled) setIsTipped(v);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Self-onboarding gate: reads the caller's own employees row (018's
  // own-row RLS). Any failure — unlinked, pre-018, pre-019 — reads as "no
  // gate" rather than trapping the user.
  const refreshSelfOnboarding = useCallback(async () => {
    if (!userId) {
      setSelfOnboardingNeeded(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("employees")
        .select("has_completed_self_onboarding, termination_date")
        .eq("auth_user_id", userId)
        .maybeSingle();
      setTerminatedOn(!error ? (data?.termination_date ?? null) : null);
      // A terminated employee is never forced through self-onboarding.
      setSelfOnboardingNeeded(
        !error &&
          data !== null &&
          data.has_completed_self_onboarding === false &&
          data.termination_date === null
      );
    } catch {
      setSelfOnboardingNeeded(false);
      setTerminatedOn(null);
    }
  }, [userId]);
  useEffect(() => {
    refreshSelfOnboarding();
  }, [refreshSelfOnboarding]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  // 2-device limit enforcement: heartbeat our device_sessions row whenever
  // the app foregrounds (and whenever the session changes — boot restore and
  // token refresh included). If our row is gone, a third device's sign-in
  // kicked us → toast + sign out. Errors (offline, migration 006 not applied
  // yet) never sign anyone out.
  const checking = useRef(false);
  useEffect(() => {
    if (!session) return;

    const runCheck = async () => {
      if (checking.current) return;
      checking.current = true;
      try {
        if ((await checkDeviceSession(session)) === "kicked") {
          showToast(KICKED_MESSAGE);
          await unregisterDeviceSession(session); // row already gone; clears the local marker
          await supabase.auth.signOut();
        }
      } catch {
        // Deliberately ignored — see above.
      } finally {
        checking.current = false;
      }
    };

    runCheck();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") runCheck();
    });
    return () => sub.remove();
  }, [session]);

  const value = useMemo<AuthContextValue>(() => {
    const user = session?.user ?? null;
    const rawTenantId = user?.user_metadata?.tenant_id;
    return {
      session,
      user,
      loading,
      mustChangePassword: user?.user_metadata?.must_change_password === true,
      needsTosAcceptance:
        user !== null &&
        user.user_metadata?.tos_accepted_version !== TOS_CURRENT_VERSION,
      tenantId:
        typeof rawTenantId === "string" && rawTenantId.length > 0
          ? rawTenantId
          : null,
      isTipped,
      selfOnboardingNeeded,
      refreshSelfOnboarding,
      terminated: terminatedOn
        ? {
            date: terminatedOn,
            daysLeft: Math.max(
              0,
              30 -
                Math.floor(
                  (Date.now() - new Date(`${terminatedOn}T00:00:00`).getTime()) /
                    86400000
                )
            ),
          }
        : null,
      signIn: async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (data.session) {
          // Fire-and-forget: sign-in must not block on (or fail with) the
          // device registration — the foreground check self-heals a miss.
          registerDeviceSession(data.session).catch((e) =>
            console.warn("device session registration failed", e)
          );
        }
        return { error: error?.message ?? null };
      },
      signOut: async () => {
        if (session) {
          await unregisterDeviceSession(session);
        }
        await supabase.auth.signOut();
      },
    };
  }, [session, loading, isTipped, selfOnboardingNeeded, refreshSelfOnboarding, terminatedOn]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

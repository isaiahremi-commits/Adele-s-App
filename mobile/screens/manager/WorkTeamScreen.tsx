import React, { useCallback, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { format } from "date-fns";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { showToast } from "../../components/Toast";
import { useAuth } from "../../contexts/AuthContext";
import type { RootStackParamList } from "../../App";
import { formatTime12, titleCase } from "../../lib/format";
import {
  type InboxCoverage,
  type TeamShift,
  approveCoverage,
  denyCoverage,
  getInbox,
  getTeamForDate,
} from "../../lib/manager";
import { colors } from "../../lib/theme";

// Work-mode Team tab (PR #18): who's on today (callouts flagged red),
// pickup requests (coverage volunteers) with inline approve/deny, and a
// jump to the full Approvals inbox for everything else (PTO, swaps,
// timecards, tip sheets — the PR #10 surface, unchanged underneath).

type Nav = NativeStackNavigationProp<RootStackParamList>;

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; team: TeamShift[]; pickups: InboxCoverage[] };

export default function WorkTeamScreen() {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestSeq = useRef(0);

  const todayKey = format(new Date(), "yyyy-MM-dd");

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      const seq = ++requestSeq.current;
      if (mode === "initial") setState({ kind: "loading" });
      else setRefreshing(true);
      try {
        const [team, inbox] = await Promise.all([
          // caller filtered out server-shape-side (PR #19: Adèle never
          // sees herself in her own team list)
          getTeamForDate(todayKey, user?.id),
          getInbox().catch(() => null),
        ]);
        if (seq === requestSeq.current) {
          setState({
            kind: "ready",
            team,
            pickups: inbox?.pending_coverage ?? [],
          });
        }
      } catch (e) {
        if (seq === requestSeq.current) {
          setState({
            kind: "error",
            message: e instanceof Error ? e.message : "Something went wrong",
          });
        }
      } finally {
        if (seq === requestSeq.current) setRefreshing(false);
      }
    },
    [todayKey, user?.id]
  );

  useFocusEffect(
    useCallback(() => {
      load(state.kind === "ready" ? "refresh" : "initial");
      // reload-on-focus only
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load])
  );

  async function decide(id: string, approve: boolean) {
    setBusy(true);
    try {
      if (approve) {
        await approveCoverage(id);
        showToast("Coverage approved — shift reassigned.");
      } else {
        await denyCoverage(id);
        showToast("Volunteer declined — request re-opened.");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
      setConfirmId(null);
      load("refresh");
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load("refresh")}
          colors={[colors.primary]}
          tintColor={colors.primary}
        />
      }
    >
      {/* Nav title stays a single word ("Team") — it shares the header row
          with the toggle + bell. The date/context lives HERE in the body. */}
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.bodyTitle}>
            Team today · {format(new Date(), "EEE, MMM d")}
          </Text>
          <Text style={styles.subGreeting}>Here's who's on today.</Text>
        </View>
        <Pressable onPress={() => navigation.navigate("Approvals")}>
          <Text style={styles.approvalsLink}>Approvals →</Text>
        </Pressable>
      </View>

      {state.kind === "loading" && (
        <Text style={styles.mutedCenter}>Loading…</Text>
      )}
      {state.kind === "error" && (
        <View style={styles.card}>
          <Text style={styles.mutedBody}>{state.message}</Text>
          <Pressable style={styles.retry} onPress={() => load("initial")}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      )}

      {state.kind === "ready" && (
        <>
          <View style={styles.card}>
            {state.team.length === 0 ? (
              <Text style={styles.mutedBody}>Nobody scheduled today.</Text>
            ) : (
              state.team.map((t, i) => (
                <View
                  key={t.shift_id}
                  style={[styles.row, i > 0 && styles.rowBorder]}
                >
                  <View
                    style={[styles.avatar, t.called_out && styles.avatarOut]}
                  >
                    <Text
                      style={[
                        styles.avatarText,
                        t.called_out && styles.avatarOutText,
                      ]}
                    >
                      {t.first_name[0]?.toUpperCase() ?? "?"}
                    </Text>
                  </View>
                  <View style={styles.rowInfo}>
                    <Text
                      style={[styles.name, t.called_out && styles.nameOut]}
                    >
                      {titleCase(t.first_name)}
                      {t.called_out ? "  " : ""}
                      {t.called_out && (
                        <Text style={styles.calledOutTag}>Called out</Text>
                      )}
                    </Text>
                    <Text style={styles.meta}>
                      {[
                        `${formatTime12(t.start_time)}–${formatTime12(t.end_time)}`,
                        titleCase(t.position),
                        t.outlet_name,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>

          <Text style={styles.sectionHeader}>
            Pickup requests ({state.pickups.length})
          </Text>
          <View style={styles.card}>
            {state.pickups.length === 0 ? (
              <Text style={styles.mutedBody}>
                No coverage volunteers waiting on you.
              </Text>
            ) : (
              state.pickups.map((c, i) => (
                <View
                  key={c.id}
                  style={[styles.pickupRow, i > 0 && styles.rowBorder]}
                >
                  <Text style={styles.name}>
                    {titleCase(c.volunteer_name) || "?"} → {titleCase(c.caller_out_name)}'s shift
                  </Text>
                  <Text style={styles.meta}>
                    {[
                      c.shift_date
                        ? format(
                            new Date(`${c.shift_date.slice(0, 10)}T00:00:00`),
                            "EEE, MMM d"
                          )
                        : "—",
                      `${formatTime12(c.start_time)}–${formatTime12(c.end_time)}`,
                      titleCase(c.position),
                      c.outlet_name,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                  {confirmId === c.id ? (
                    <View style={styles.decideRow}>
                      <Text style={styles.confirmText}>Approve pickup?</Text>
                      <Pressable
                        disabled={busy}
                        onPress={() => decide(c.id, true)}
                      >
                        <Text style={styles.approveText}>
                          {busy ? "Working..." : "Yes, approve"}
                        </Text>
                      </Pressable>
                      <Pressable disabled={busy} onPress={() => decide(c.id, false)}>
                        <Text style={styles.denyText}>Deny</Text>
                      </Pressable>
                      <Pressable onPress={() => setConfirmId(null)}>
                        <Text style={styles.mutedBody}>Back</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.decideRow}>
                      <Pressable
                        style={styles.approveButton}
                        onPress={() => setConfirmId(c.id)}
                      >
                        <Text style={styles.approveButtonText}>Approve</Text>
                      </Pressable>
                      <Pressable onPress={() => setConfirmId(c.id)}>
                        <Text style={styles.denyText}>Deny</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ))
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 16,
    gap: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerText: {
    flex: 1,
    paddingRight: 8,
  },
  bodyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.foreground,
  },
  subGreeting: {
    marginTop: 1,
    fontSize: 13,
    color: colors.muted,
  },
  approvalsLink: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.primaryDim,
  },
  sectionHeader: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: "600",
    color: colors.foreground,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarOut: {
    borderColor: "#dc2626",
    backgroundColor: "rgba(220, 38, 38, 0.08)",
  },
  avatarText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primaryDim,
  },
  avatarOutText: {
    color: "#dc2626",
  },
  rowInfo: {
    flex: 1,
  },
  name: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  nameOut: {
    color: "#dc2626",
  },
  calledOutTag: {
    fontSize: 11,
    fontWeight: "700",
    color: "#dc2626",
  },
  meta: {
    marginTop: 1,
    fontSize: 12,
    color: colors.muted,
  },
  pickupRow: {
    paddingVertical: 10,
  },
  decideRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 8,
    flexWrap: "wrap",
  },
  confirmText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
  },
  approveButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  approveButtonText: {
    color: colors.primaryOn,
    fontSize: 13,
    fontWeight: "600",
  },
  approveText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.primaryDim,
  },
  denyText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#dc2626",
  },
  mutedBody: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
  },
  mutedCenter: {
    textAlign: "center",
    color: colors.muted,
    marginTop: 24,
  },
  retry: {
    marginTop: 10,
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  retryText: {
    color: colors.primaryOn,
    fontSize: 13,
    fontWeight: "600",
  },
});

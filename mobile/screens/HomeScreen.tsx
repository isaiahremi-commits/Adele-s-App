import React, { useCallback, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { format } from "date-fns";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import ShiftDetailModal from "../components/ShiftDetailModal";
import { showToast } from "../components/Toast";
import { useAuth } from "../contexts/AuthContext";
import type { RootStackParamList } from "../App";
import { type InboxItem, getInbox } from "../lib/broadcasts";
import { submitRunningLate } from "../lib/coverage";
import { formatTime12, titleCase } from "../lib/format";
import { getMyCalloutSummary } from "../lib/pay";
import { getMyBalance } from "../lib/pto";
import {
  type CurrentEmployee,
  type ScheduleShift,
  type TeammateShift,
  formatShiftTime,
  getCurrentEmployee,
  getShiftsForWeek,
  getTeammatesForWeek,
} from "../lib/schedule";
import { colors } from "../lib/theme";
import CalloutModal from "./CalloutModal";

// Employee Home tab (PR #18): time-of-day greeting, today's shift card
// ("Working with you" count taps into the shared shift-detail sheet), quick
// actions (Running late → running_late_submit; Call out → the PR #8 modal
// preloaded with PTO balance + 90-day callout count + a use-PTO toggle),
// and the two newest broadcasts with a jump to the Inbox. Everything
// degrades section-by-section — a failed feed hides, never breaks Home.

type Nav = NativeStackNavigationProp<RootStackParamList>;

const LATE_CHOICES = [10, 15, 30, 45, 60] as const;

function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unlinked" }
  | {
      kind: "ready";
      employee: CurrentEmployee;
      todayShifts: ScheduleShift[];
      teammates: TeammateShift[];
      broadcasts: InboxItem[];
      ptoBalance: number;
      callouts90d: number;
    };

export default function HomeScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<Nav>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [detailShift, setDetailShift] = useState<ScheduleShift | null>(null);
  const [calloutShift, setCalloutShift] = useState<ScheduleShift | null>(null);
  const [lateOpen, setLateOpen] = useState(false);
  const [lateMinutes, setLateMinutes] = useState<number | null>(null);
  const [lateBusy, setLateBusy] = useState(false);
  const requestSeq = useRef(0);

  // PR #19 bug 1 (Adèle's Home stuck on "Loading…"): fetch has NO timeout
  // on RN/web, so gating first paint on a five-way Promise.all meant one
  // stalled request froze the spinner forever — and the manager data path
  // had the longest poles (multi-row balance resolve + a nested auth
  // round-trip). Restructured: paint the core card as soon as the two
  // critical reads land (watchdogged — worst case is the retry state, never
  // an infinite spinner), then hydrate each side section independently;
  // a section that fails or stalls just keeps its default.
  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!user) return;
      const seq = ++requestSeq.current;
      if (mode === "initial") setState({ kind: "loading" });
      else setRefreshing(true);

      const timeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
        Promise.race([
          p,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error("Request timed out")), ms)
          ),
        ]);
      const current = () => seq === requestSeq.current;
      const patch = (partial: Partial<Extract<LoadState, { kind: "ready" }>>) =>
        setState((cur) =>
          cur.kind === "ready" && current() ? { ...cur, ...partial } : cur
        );

      try {
        const employee = await timeout(getCurrentEmployee(user.id), 8000);
        if (!employee) {
          if (current()) setState({ kind: "unlinked" });
          return;
        }
        const today = new Date();
        const todayShifts = await timeout(
          getShiftsForWeek(employee.id, today, today),
          8000
        ).catch(() => [] as ScheduleShift[]);
        if (!current()) return;
        setState({
          kind: "ready",
          employee,
          todayShifts,
          teammates: [],
          broadcasts: [],
          ptoBalance: 0,
          callouts90d: 0,
        });

        // Background hydration — independent, fail-soft, never blocks paint.
        getTeammatesForWeek(today, today)
          .then((teammates) => patch({ teammates }))
          .catch(() => {});
        getInbox()
          .then((all) => patch({ broadcasts: all.slice(0, 2) }))
          .catch(() => {});
        getMyBalance()
          .then((ptoBalance) => patch({ ptoBalance }))
          .catch(() => {});
        getMyCalloutSummary(
          format(new Date(Date.now() - 90 * 86400000), "yyyy-MM-dd"),
          employee.id
        )
          .then((c) => patch({ callouts90d: c.count }))
          .catch(() => {});
      } catch (e) {
        if (current()) {
          setState({
            kind: "error",
            message: e instanceof Error ? e.message : "Something went wrong",
          });
        }
      } finally {
        if (current()) setRefreshing(false);
      }
    },
    [user]
  );

  useFocusEffect(
    useCallback(() => {
      load(state.kind === "ready" ? "refresh" : "initial");
      // reload-on-focus only
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load])
  );

  async function onSubmitLate() {
    if (!lateMinutes) return;
    setLateBusy(true);
    try {
      const shiftId =
        state.kind === "ready" ? state.todayShifts[0]?.id : undefined;
      await submitRunningLate(lateMinutes, shiftId);
      showToast(
        `Noted — your manager can see you're running ~${lateMinutes} min late.`
      );
      setLateOpen(false);
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Couldn't record that — try again."
      );
    } finally {
      setLateBusy(false);
      setLateMinutes(null);
    }
  }

  const now = new Date();
  const firstShift = state.kind === "ready" ? state.todayShifts[0] : null;
  const todayTeammates =
    state.kind === "ready" && firstShift
      ? state.teammates.filter(
          (t) =>
            t.date === firstShift.date && t.outlet_id === firstShift.outlet_id
        )
      : [];

  return (
    <View style={styles.screen}>
      <ScrollView
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
        {state.kind === "loading" && (
          <Text style={styles.mutedCenter}>Loading…</Text>
        )}

        {state.kind === "error" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Couldn't load your day</Text>
            <Text style={styles.mutedBody}>{state.message}</Text>
            <Pressable
              style={styles.primaryButton}
              onPress={() => load("initial")}
            >
              <Text style={styles.primaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {state.kind === "unlinked" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Welcome</Text>
            <Text style={styles.mutedBody}>
              Your account isn't linked to an employee record yet — contact
              your manager.
            </Text>
          </View>
        )}

        {state.kind === "ready" && (
          <>
            <Text style={styles.greeting}>
              {greeting(now)}, {titleCase(state.employee.first_name)}
            </Text>

            {/* Today's shift */}
            <View style={styles.card}>
              {firstShift ? (
                <>
                  <Text style={styles.cardTitle}>
                    Today at {firstShift.outlets?.name ?? "work"}
                  </Text>
                  <Text style={styles.shiftLine}>
                    {formatShiftTime(firstShift.start_time)} –{" "}
                    {formatShiftTime(firstShift.end_time)}
                    {firstShift.position
                      ? ` · ${titleCase(firstShift.position)}`
                      : ""}
                  </Text>
                  {state.todayShifts.length > 1 && (
                    <Text style={styles.mutedBody}>
                      +{state.todayShifts.length - 1} more shift
                      {state.todayShifts.length > 2 ? "s" : ""} today
                    </Text>
                  )}
                  {firstShift.notes ? (
                    <Text style={styles.shiftNotes}>{firstShift.notes}</Text>
                  ) : null}
                  <Pressable onPress={() => setDetailShift(firstShift)}>
                    <Text style={styles.teammatesLink}>
                      Working with you: {todayTeammates.length}{" "}
                      {todayTeammates.length === 1 ? "teammate" : "teammates"} →
                    </Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.cardTitle}>You're off today</Text>
                  <Text style={styles.mutedBody}>
                    Enjoy it — check the Schedule tab for the rest of the week.
                  </Text>
                </>
              )}
            </View>

            {/* Quick actions */}
            <View style={styles.actionsRow}>
              <Pressable
                style={[styles.actionButton, !firstShift && styles.dim]}
                disabled={!firstShift}
                onPress={() => setLateOpen(true)}
              >
                <Ionicons name="time-outline" size={20} color={colors.amber} />
                <Text style={styles.actionText}>Running late</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, !firstShift && styles.dim]}
                disabled={!firstShift}
                onPress={() => setCalloutShift(firstShift)}
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={20}
                  color="#dc2626"
                />
                <Text style={styles.actionText}>Call out</Text>
              </Pressable>
            </View>

            {/* Recent broadcasts */}
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>Messages</Text>
                <Pressable onPress={() => navigation.navigate("Inbox")}>
                  <Text style={styles.seeAll}>See all →</Text>
                </Pressable>
              </View>
              {state.broadcasts.length === 0 ? (
                <Text style={styles.mutedBody}>No messages yet.</Text>
              ) : (
                state.broadcasts.map((b) => (
                  <Pressable
                    key={b.broadcast_id}
                    style={styles.broadcastRow}
                    onPress={() =>
                      navigation.navigate("BroadcastDetail", {
                        broadcastId: b.broadcast_id,
                      })
                    }
                  >
                    <Text style={styles.broadcastSender}>
                      {b.is_mine ? "You" : titleCase(b.sender_name)}
                      <Text style={styles.broadcastWhen}>
                        {"  "}
                        {format(new Date(b.created_at), "MMM d")}
                      </Text>
                    </Text>
                    <Text style={styles.broadcastBody} numberOfLines={1}>
                      {b.body}
                    </Text>
                  </Pressable>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>

      {detailShift && state.kind === "ready" && (
        <ShiftDetailModal
          shift={detailShift}
          teammates={todayTeammates}
          onClose={() => setDetailShift(null)}
        />
      )}

      <CalloutModal
        visible={calloutShift !== null}
        shift={calloutShift}
        preload={
          state.kind === "ready"
            ? {
                ptoBalance: state.ptoBalance,
                callouts90d: state.callouts90d,
              }
            : null
        }
        onClose={() => setCalloutShift(null)}
        onSubmitted={() => {
          setCalloutShift(null);
          load("refresh");
        }}
      />

      {/* Running-late confirm sheet */}
      <Modal
        visible={lateOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setLateOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setLateOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Running late</Text>
            <Text style={styles.mutedBody}>
              How many minutes behind are you?
              {firstShift?.start_time
                ? ` Your shift starts at ${formatTime12(firstShift.start_time)}.`
                : ""}
            </Text>
            <View style={styles.lateChips}>
              {LATE_CHOICES.map((m) => (
                <Pressable
                  key={m}
                  style={[styles.chip, lateMinutes === m && styles.chipActive]}
                  onPress={() => setLateMinutes(m)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      lateMinutes === m && styles.chipTextActive,
                    ]}
                  >
                    {m} min
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.lateNote}>
              This records the heads-up for your manager. Until push
              notifications land, they'll see it when they check the app.
            </Text>
            <View style={styles.sheetButtons}>
              <Pressable onPress={() => setLateOpen(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.primaryButton,
                  (!lateMinutes || lateBusy) && styles.dim,
                ]}
                disabled={!lateMinutes || lateBusy}
                onPress={onSubmitLate}
              >
                <Text style={styles.primaryButtonText}>
                  {lateBusy ? "Sending..." : "Send"}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  greeting: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.foreground,
    marginTop: 4,
    marginBottom: 2,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.foreground,
  },
  shiftLine: {
    marginTop: 4,
    fontSize: 15,
    fontWeight: "500",
    color: colors.foreground,
  },
  shiftNotes: {
    marginTop: 6,
    fontSize: 13,
    color: colors.muted,
    fontStyle: "italic",
  },
  teammatesLink: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: "600",
    color: colors.primaryDim,
  },
  mutedBody: {
    marginTop: 4,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
  },
  mutedCenter: {
    textAlign: "center",
    color: colors.muted,
    marginTop: 24,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
  },
  actionText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  seeAll: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primaryDim,
  },
  broadcastRow: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  broadcastSender: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
  },
  broadcastWhen: {
    fontSize: 12,
    fontWeight: "400",
    color: colors.muted,
  },
  broadcastBody: {
    marginTop: 2,
    fontSize: 13,
    color: colors.muted,
  },
  primaryButton: {
    marginTop: 12,
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: colors.primaryOn,
    fontSize: 14,
    fontWeight: "600",
  },
  dim: {
    opacity: 0.5,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 18,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.foreground,
  },
  lateChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.background,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: "rgba(45, 184, 122, 0.12)",
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
  },
  chipTextActive: {
    color: colors.primaryDim,
  },
  lateNote: {
    marginTop: 12,
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
  },
  sheetButtons: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 16,
    marginTop: 6,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.muted,
    marginTop: 12,
  },
});

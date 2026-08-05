import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
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
import {
  cycleLength,
  currentPeriod,
  formatPeriod,
  previousPeriod,
  todayISO,
  type Period,
} from "../../shared/payroll";
import { useAuth } from "../contexts/AuthContext";
import {
  type CalloutSummary,
  type LatenessSummary,
  type PayBreakdown,
  type PaySettings,
  type Timecard,
  getMyCalloutSummary,
  getMyLatenessSummary,
  getMyPayBreakdown,
  getMyTimecards,
  getPaySettings,
} from "../lib/pay";
import { getCurrentEmployee } from "../lib/schedule";
import { colors } from "../lib/theme";

// Pay tab: current-period estimate, a Current/Previous/Older period picker
// (same boundaries as the web /payroll page — shared/payroll.ts), the
// earnings breakdown + timecards for the selected period, and a standing
// card (lateness + callouts over the last 90 days). All data is the signed-in
// employee's own: pay_breakdown_for_me / employee_pay_settings RPCs + own-row
// RLS from migration 008.

const STANDING_DAYS = 90;
const OLDER_PERIOD_CHOICES = 6; // periods 2..7 back, in the Older sheet

function fmtUSD(n: number | null): string {
  if (n === null) return "—";
  return (
    "$" +
    n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** 7.5 → "7.5h", 8 → "8h", 7.25 → "7.25h" */
function fmtHours(n: number): string {
  return `${Number(n.toFixed(2))}h`;
}

/** timestamptz ISO → "9:05 AM"; null-safe. */
function fmtClock(iso: string | null): string {
  return iso ? format(new Date(iso), "h:mm a") : "—";
}

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unlinked" }
  | {
      kind: "ready";
      settings: PaySettings;
      current: Period;
      selected: Period;
      breakdown: PayBreakdown | null;
      currentActual: PayBreakdown | null;
      currentPrediction: PayBreakdown | null;
      timecards: Timecard[];
      lateness: LatenessSummary;
      callouts: CalloutSummary;
    };

export default function PayScreen() {
  const { user } = useAuth();
  const [periodsBack, setPeriodsBack] = useState(0);
  const [olderOpen, setOlderOpen] = useState(false);
  const [timecardsOpen, setTimecardsOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const requestSeq = useRef(0);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!user) return;
      const seq = ++requestSeq.current;
      if (mode === "initial") setState({ kind: "loading" });
      else setRefreshing(true);
      try {
        // "Am I linked?" is answered by the RPC itself (it raises a specific
        // error for unlinked accounts), NOT by reading the employees table —
        // that read is still manager-only under RLS, so gating on it would
        // wrongly show "unlinked" to every real employee. The lookup below is
        // only best-effort: when it CAN resolve an id (managers), the table
        // reads get an explicit employee filter, because a manager's RLS
        // otherwise returns the whole org's rows.
        const employeeId =
          (await getCurrentEmployee(user.id).catch(() => null))?.id ?? null;
        const settings = await getPaySettings();
        const cycle = cycleLength(settings.pay_cycle);
        const current = currentPeriod(cycle, todayISO());
        let selected = current;
        for (let i = 0; i < periodsBack; i++) {
          selected = previousPeriod(selected, cycle);
        }
        const since = daysAgoISO(STANDING_DAYS);
        const [
          breakdown,
          timecards,
          currentPrediction,
          lateness,
          callouts,
          currentActualFetched,
        ] = await Promise.all([
          getMyPayBreakdown(selected.start, selected.end),
          getMyTimecards(selected.start, selected.end, employeeId),
          getMyPayBreakdown(current.start, current.end, "prediction"),
          getMyLatenessSummary(since, employeeId),
          getMyCalloutSummary(since, employeeId),
          // when viewing the current period, the selected fetch IS the
          // current-actual — skip the duplicate round trip
          periodsBack === 0
            ? Promise.resolve(null)
            : getMyPayBreakdown(current.start, current.end),
        ]);
        if (seq === requestSeq.current) {
          setState({
            kind: "ready",
            settings,
            current,
            selected,
            breakdown,
            currentActual: periodsBack === 0 ? breakdown : currentActualFetched,
            currentPrediction,
            timecards,
            lateness,
            callouts,
          });
        }
      } catch (e) {
        if (seq === requestSeq.current) {
          const message = e instanceof Error ? e.message : "Something went wrong";
          // raised by pay_breakdown_for_me / employee_pay_settings (008)
          if (message.includes("No employee record")) {
            setState({ kind: "unlinked" });
          } else {
            setState({ kind: "error", message });
          }
        }
      } finally {
        if (seq === requestSeq.current) setRefreshing(false);
      }
    },
    [user, periodsBack]
  );

  useEffect(() => {
    load("initial");
  }, [load]);

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
            title="Refreshing..."
          />
        }
      >
        {refreshing && <Text style={styles.refreshingNote}>Refreshing...</Text>}

        {state.kind === "loading" && <SkeletonCards />}

        {state.kind === "error" && (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>Couldn't load your pay</Text>
            <Text style={styles.emptyBody}>{state.message}</Text>
            <Pressable style={styles.retryButton} onPress={() => load("initial")}>
              <Text style={styles.retryButtonText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {state.kind === "unlinked" && (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>No employee record</Text>
            <Text style={styles.emptyBody}>
              Your account isn't linked to an employee record yet — contact
              your manager.
            </Text>
          </View>
        )}

        {state.kind === "ready" && (
          <>
            <CurrentEstimateCard state={state} />
            <PeriodPicker
              periodsBack={periodsBack}
              onSelect={(n) => {
                setPeriodsBack(n);
                setOlderOpen(false);
              }}
              olderOpen={olderOpen}
              setOlderOpen={setOlderOpen}
              current={state.current}
              cycle={cycleLength(state.settings.pay_cycle)}
            />
            <EarningsCard
              breakdown={state.breakdown}
              periodLabel={formatPeriod(state.selected)}
            />
            <TimecardsCard
              timecards={state.timecards}
              periodLabel={formatPeriod(state.selected)}
              open={timecardsOpen}
              onToggle={() => setTimecardsOpen((v) => !v)}
            />
            <StandingCard
              lateness={state.lateness}
              callouts={state.callouts}
              settings={state.settings}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function CurrentEstimateCard({
  state,
}: {
  state: Extract<LoadState, { kind: "ready" }>;
}) {
  const actual = state.currentActual;
  const hoursSoFar = actual
    ? actual.regular_hours + actual.ot_hours + actual.training_hours
    : 0;
  const projected = state.currentPrediction?.gross_pay ?? null;
  return (
    <View style={[styles.card, styles.estimateCard]}>
      <Text style={styles.estimateLabel}>Current pay period</Text>
      <Text style={styles.estimatePeriod}>{formatPeriod(state.current)}</Text>
      <Text style={styles.estimateValue}>{fmtUSD(projected)}</Text>
      <Text style={styles.estimateHint}>projected gross</Text>
      <Text style={styles.estimateHours}>
        {fmtHours(hoursSoFar)} worked so far this period
      </Text>
    </View>
  );
}

function PeriodPicker({
  periodsBack,
  onSelect,
  olderOpen,
  setOlderOpen,
  current,
  cycle,
}: {
  periodsBack: number;
  onSelect: (n: number) => void;
  olderOpen: boolean;
  setOlderOpen: (v: boolean) => void;
  current: Period;
  cycle: number;
}) {
  // periods 2..(1 + OLDER_PERIOD_CHOICES) back, for the Older sheet
  const older = useMemo(() => {
    const out: { back: number; period: Period }[] = [];
    let p = previousPeriod(current, cycle);
    for (let back = 2; back <= 1 + OLDER_PERIOD_CHOICES; back++) {
      p = previousPeriod(p, cycle);
      out.push({ back, period: p });
    }
    return out;
  }, [current, cycle]);

  return (
    <>
      <View style={styles.pickerTabs}>
        {(
          [
            { label: "Current", back: 0 },
            { label: "Previous", back: 1 },
          ] as const
        ).map((opt) => (
          <Pressable
            key={opt.back}
            style={[
              styles.pickerTab,
              periodsBack === opt.back && styles.pickerTabActive,
            ]}
            onPress={() => onSelect(opt.back)}
          >
            <Text
              style={[
                styles.pickerTabText,
                periodsBack === opt.back && styles.pickerTabTextActive,
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        ))}
        <Pressable
          style={[styles.pickerTab, periodsBack >= 2 && styles.pickerTabActive]}
          onPress={() => setOlderOpen(true)}
        >
          <Text
            style={[
              styles.pickerTabText,
              periodsBack >= 2 && styles.pickerTabTextActive,
            ]}
          >
            Older
          </Text>
          <Ionicons
            name="chevron-down"
            size={13}
            color={periodsBack >= 2 ? colors.foreground : colors.muted}
          />
        </Pressable>
      </View>

      <Modal
        visible={olderOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setOlderOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setOlderOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Older pay periods</Text>
            {older.map(({ back, period }) => (
              <Pressable
                key={back}
                style={[
                  styles.modalRow,
                  periodsBack === back && styles.modalRowActive,
                ]}
                onPress={() => onSelect(back)}
              >
                <Text
                  style={[
                    styles.modalRowText,
                    periodsBack === back && styles.modalRowTextActive,
                  ]}
                >
                  {formatPeriod(period)}
                </Text>
                {periodsBack === back && (
                  <Ionicons name="checkmark" size={16} color={colors.primary} />
                )}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function EarningsCard({
  breakdown,
  periodLabel,
}: {
  breakdown: PayBreakdown | null;
  periodLabel: string;
}) {
  if (!breakdown) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Earnings breakdown</Text>
        <Text style={styles.sectionSubtitle}>{periodLabel}</Text>
        <Text style={styles.emptyBody}>No pay activity in this period.</Text>
      </View>
    );
  }
  // only rows with something in them (hours worked or dollars earned)
  const rows: { label: string; detail: string | null; amount: number | null }[] =
    [];
  if (breakdown.regular_hours > 0 || (breakdown.regular_pay ?? 0) !== 0) {
    rows.push({
      label: breakdown.pay_type === "salary" ? "Salary" : "Regular",
      detail:
        breakdown.pay_type === "salary" ? null : fmtHours(breakdown.regular_hours),
      amount: breakdown.regular_pay,
    });
  }
  if (breakdown.ot_hours > 0) {
    rows.push({
      label: "Overtime",
      detail: fmtHours(breakdown.ot_hours),
      amount: breakdown.ot_pay,
    });
  }
  if (breakdown.pto_hours > 0) {
    rows.push({
      label: "PTO",
      detail: fmtHours(breakdown.pto_hours),
      amount: breakdown.pto_pay,
    });
  }
  if (breakdown.training_hours > 0) {
    rows.push({
      label: "Training",
      detail: fmtHours(breakdown.training_hours),
      amount: breakdown.training_pay,
    });
  }
  if (breakdown.tip_rows_amount !== 0) {
    rows.push({ label: "Tips", detail: null, amount: breakdown.tip_rows_amount });
  }
  if (breakdown.manager_amount !== 0) {
    rows.push({
      label: "Manager Commission",
      detail: null,
      amount: breakdown.manager_amount,
    });
  }
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Earnings breakdown</Text>
      <Text style={styles.sectionSubtitle}>{periodLabel}</Text>
      {rows.length === 0 && (
        <Text style={styles.emptyBody}>No earnings in this period.</Text>
      )}
      {rows.map((row) => (
        <View key={row.label} style={styles.earningRow}>
          <View style={styles.earningLabelWrap}>
            <Text style={styles.earningLabel}>{row.label}</Text>
            {row.detail && <Text style={styles.earningDetail}>{row.detail}</Text>}
          </View>
          <Text style={styles.earningAmount}>{fmtUSD(row.amount)}</Text>
        </View>
      ))}
      <View style={[styles.earningRow, styles.grossRow]}>
        <Text style={styles.grossLabel}>Gross total</Text>
        <Text style={styles.grossAmount}>{fmtUSD(breakdown.gross_pay)}</Text>
      </View>
      {breakdown.warnings.length > 0 && (
        <Text style={styles.warningNote}>
          ⚠ {breakdown.warnings.join(" · ")} — ask your manager.
        </Text>
      )}
    </View>
  );
}

function TimecardsCard({
  timecards,
  periodLabel,
  open,
  onToggle,
}: {
  timecards: Timecard[];
  periodLabel: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={styles.card}>
      <Pressable style={styles.collapseHeader} onPress={onToggle}>
        <View>
          <Text style={styles.sectionTitle}>
            Timecards ({timecards.length})
          </Text>
          <Text style={styles.sectionSubtitle}>{periodLabel}</Text>
        </View>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.muted}
        />
      </Pressable>
      {open &&
        (timecards.length === 0 ? (
          <Text style={[styles.emptyBody, styles.collapseBody]}>
            No timecards in this period.
          </Text>
        ) : (
          timecards.map((tc) => {
            const hours =
              (tc.regular_hours ?? 0) +
              (tc.ot_hours ?? 0) +
              (tc.training_hours ?? 0);
            return (
              <View key={tc.id} style={styles.timecardRow}>
                <View style={styles.timecardLeft}>
                  <Text style={styles.timecardDate}>
                    {format(new Date(`${tc.date}T00:00:00`), "EEE, MMM d")}
                  </Text>
                  <Text style={styles.timecardTimes}>
                    {fmtClock(tc.clock_in)} – {fmtClock(tc.clock_out)}
                  </Text>
                </View>
                <View style={styles.timecardRight}>
                  <Text style={styles.timecardHours}>{fmtHours(hours)}</Text>
                  <StatusPill status={tc.status} />
                </View>
              </View>
            );
          })
        ))}
    </View>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "approved" || status === "posted"
      ? { bg: "rgba(45, 184, 122, 0.14)", fg: colors.primaryDim }
      : { bg: "rgba(217, 119, 6, 0.14)", fg: colors.amber };
  return (
    <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
      <Text style={[styles.statusPillText, { color: tone.fg }]}>{status}</Text>
    </View>
  );
}

function StandingCard({
  lateness,
  callouts,
  settings,
}: {
  lateness: LatenessSummary;
  callouts: CalloutSummary;
  settings: PaySettings;
}) {
  // Threshold is judged on the (usually shorter) rolling window from setup,
  // not the 90-day display window — same as the web /reports flag.
  const windowStart = daysAgoISO(settings.callout_threshold_window_days);
  const rollingCount = callouts.dates.filter((d) => d >= windowStart).length;
  const overThreshold = rollingCount >= settings.callout_threshold_count;
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Your standing</Text>
      <Text style={styles.sectionSubtitle}>last {STANDING_DAYS} days</Text>
      <View style={styles.standingRow}>
        <Ionicons name="time-outline" size={18} color={colors.muted} />
        <Text style={styles.standingLabel}>Lateness</Text>
        <Text style={styles.standingValue}>
          {lateness.count} {lateness.count === 1 ? "incident" : "incidents"}
          {lateness.tier2Count > 0 ? ` (${lateness.tier2Count} tier-2)` : ""}
        </Text>
      </View>
      <View style={styles.standingRow}>
        <Ionicons name="call-outline" size={18} color={colors.muted} />
        <Text style={styles.standingLabel}>Callouts</Text>
        <Text style={styles.standingValue}>{callouts.count}</Text>
      </View>
      {overThreshold && (
        <Text style={styles.warningNote}>
          ⚠ {rollingCount} callouts in the last{" "}
          {settings.callout_threshold_window_days} days — at the limit of{" "}
          {settings.callout_threshold_count}. Talk to your manager.
        </Text>
      )}
    </View>
  );
}

function SkeletonCards() {
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 650,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.card}>
          <Animated.View
            style={[styles.skeletonLine, { opacity: pulse, width: "45%" }]}
          />
          <Animated.View style={[styles.skeletonBlock, { opacity: pulse }]} />
          <Animated.View
            style={[styles.skeletonLine, { opacity: pulse, width: "65%" }]}
          />
        </View>
      ))}
    </>
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
  refreshingNote: {
    textAlign: "center",
    fontSize: 12,
    color: colors.muted,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  estimateCard: {
    alignItems: "center",
  },
  estimateLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  estimatePeriod: {
    marginTop: 2,
    fontSize: 13,
    color: colors.muted,
  },
  estimateValue: {
    marginTop: 8,
    fontSize: 34,
    fontWeight: "700",
    color: colors.foreground,
  },
  estimateHint: {
    fontSize: 13,
    color: colors.muted,
  },
  estimateHours: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: "500",
    color: colors.foreground,
  },
  pickerTabs: {
    flexDirection: "row",
    backgroundColor: colors.border,
    borderRadius: 10,
    padding: 3,
  },
  pickerTab: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 3,
    paddingVertical: 8,
    borderRadius: 8,
  },
  pickerTabActive: {
    backgroundColor: colors.card,
  },
  pickerTabText: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.muted,
  },
  pickerTabTextActive: {
    color: colors.foreground,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: 8,
  },
  modalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalRowActive: {
    borderBottomColor: colors.primary,
  },
  modalRowText: {
    fontSize: 15,
    color: colors.foreground,
  },
  modalRowTextActive: {
    fontWeight: "600",
    color: colors.primaryDim,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.foreground,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 10,
  },
  earningRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 7,
  },
  earningLabelWrap: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  earningLabel: {
    fontSize: 14,
    color: colors.foreground,
  },
  earningDetail: {
    fontSize: 12,
    color: colors.muted,
  },
  earningAmount: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  grossRow: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  grossLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.foreground,
  },
  grossAmount: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  warningNote: {
    marginTop: 10,
    fontSize: 13,
    color: colors.amber,
    lineHeight: 18,
  },
  collapseHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  collapseBody: {
    marginTop: 8,
  },
  timecardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  timecardLeft: {
    flexShrink: 1,
  },
  timecardDate: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  timecardTimes: {
    marginTop: 1,
    fontSize: 13,
    color: colors.muted,
  },
  timecardRight: {
    alignItems: "flex-end",
    gap: 3,
  },
  timecardHours: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "600",
  },
  standingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 7,
  },
  standingLabel: {
    flex: 1,
    fontSize: 14,
    color: colors.foreground,
  },
  standingValue: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: 6,
  },
  emptyBody: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
  },
  retryButton: {
    marginTop: 14,
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  retryButtonText: {
    color: colors.primaryOn,
    fontSize: 14,
    fontWeight: "600",
  },
  skeletonLine: {
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.border,
    marginBottom: 10,
  },
  skeletonBlock: {
    height: 56,
    borderRadius: 8,
    backgroundColor: colors.border,
    marginBottom: 10,
  },
});

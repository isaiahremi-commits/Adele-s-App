import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { addDays, addWeeks, endOfISOWeek, format, startOfISOWeek } from "date-fns";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../contexts/AuthContext";
import type { ScheduleStackParamList } from "../lib/navigation";
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
import {
  type TipStatus,
  getTipStatusForShifts,
  shiftTipKey,
} from "../lib/tips";

// Employee schedule: own shifts for this/next ISO week (Mon–Sun, local time)
// as day cards, plus a collapsible same-department/same-outlet teammates
// section. Data flow: employees row for the auth user → own shifts → teammate
// shifts at my outlets. RLS scopes everything by tenant server-side.
// Past shifts additionally carry a tip-declaration action row (PR #7), fed by
// tip_declaration_for_me batched per unique (outlet, day).

type WeekTab = "this" | "next";

/** A shift already worked: earlier day, or today with its end time passed. */
function isPastShift(
  s: ScheduleShift,
  todayKey: string,
  nowTime: string
): boolean {
  if (!s.date) return false;
  if (s.date < todayKey) return true;
  if (s.date > todayKey) return false;
  return !!s.end_time && s.end_time <= nowTime;
}

function fmtUSD(n: number): string {
  return (
    "$" +
    n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unlinked" }
  | {
      kind: "ready";
      employee: CurrentEmployee;
      shifts: ScheduleShift[];
      teammates: TeammateShift[];
    };

export default function ScheduleScreen() {
  const { user } = useAuth();
  const navigation =
    useNavigation<
      NativeStackNavigationProp<ScheduleStackParamList, "ScheduleList">
    >();
  const [week, setWeek] = useState<WeekTab>("this");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [teammatesOpen, setTeammatesOpen] = useState(false);
  // null = statuses unavailable (RPC missing pre-009, or a fetch error) —
  // the schedule itself still renders, just without tip action rows.
  const [tipStatuses, setTipStatuses] = useState<Map<string, TipStatus> | null>(
    null
  );
  const requestSeq = useRef(0);

  const weekStart = useMemo(() => {
    const thisWeek = startOfISOWeek(new Date());
    return week === "next" ? addWeeks(thisWeek, 1) : thisWeek;
  }, [week]);
  const weekEnd = useMemo(() => endOfISOWeek(weekStart), [weekStart]);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!user) return;
      const seq = ++requestSeq.current;
      if (mode === "initial") setState({ kind: "loading" });
      else setRefreshing(true);
      try {
        const employee = await getCurrentEmployee(user.id);
        if (!employee) {
          if (seq === requestSeq.current) setState({ kind: "unlinked" });
          return;
        }
        const shifts = await getShiftsForWeek(employee.id, weekStart, weekEnd);
        const outletIds = [
          ...new Set(
            shifts
              .map((s) => s.outlet_id)
              .filter((id): id is string => id !== null)
          ),
        ];
        const teammates = await getTeammatesForWeek(
          employee,
          weekStart,
          weekEnd,
          outletIds
        );
        if (seq === requestSeq.current) {
          setState({ kind: "ready", employee, shifts, teammates });
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
    [user, weekStart, weekEnd]
  );

  useEffect(() => {
    load("initial");
  }, [load]);

  // Tip statuses for past shifts, one RPC per unique (outlet, day). Runs on
  // ready/week-change and again whenever the screen regains focus, so coming
  // back from TipDeclarationScreen shows the fresh badge. Failures (e.g. the
  // 009 RPCs not applied yet) just hide the tip rows — never the schedule.
  const loadTipStatuses = useCallback(async (shifts: ScheduleShift[]) => {
    const now = new Date();
    const todayKey = format(now, "yyyy-MM-dd");
    const nowTime = format(now, "HH:mm:ss");
    const pairs = shifts
      .filter(
        (s): s is ScheduleShift & { date: string; outlet_id: string } =>
          s.date !== null &&
          s.outlet_id !== null &&
          isPastShift(s, todayKey, nowTime)
      )
      .map((s) => ({ outletId: s.outlet_id, date: s.date }));
    if (pairs.length === 0) {
      setTipStatuses(new Map());
      return;
    }
    try {
      setTipStatuses(await getTipStatusForShifts(pairs));
    } catch {
      setTipStatuses(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (state.kind === "ready") loadTipStatuses(state.shifts);
    }, [state, loadTipStatuses])
  );

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const weekLabel = week === "this" ? "this week" : "next week";
  const now = new Date();
  const todayKey = format(now, "yyyy-MM-dd");
  const nowTime = format(now, "HH:mm:ss");

  return (
    <View style={styles.screen}>
      <View style={styles.weekTabs}>
        {(["this", "next"] as const).map((tab) => (
          <Pressable
            key={tab}
            style={[styles.weekTab, week === tab && styles.weekTabActive]}
            onPress={() => setWeek(tab)}
          >
            <Text
              style={[
                styles.weekTabText,
                week === tab && styles.weekTabTextActive,
              ]}
            >
              {tab === "this" ? "This Week" : "Next Week"}
            </Text>
          </Pressable>
        ))}
      </View>

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
            <Text style={styles.emptyTitle}>Couldn't load your schedule</Text>
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
            {state.shifts.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.emptyTitle}>
                  No shifts scheduled {weekLabel}
                </Text>
                <Text style={styles.emptyBody}>
                  Enjoy the time off! Pull down to refresh.
                </Text>
              </View>
            ) : (
              days.map((day) => {
                const dayKey = format(day, "yyyy-MM-dd");
                const dayShifts = state.shifts.filter((s) => s.date === dayKey);
                if (dayShifts.length === 0) return null;
                return (
                  <View key={dayKey} style={styles.card}>
                    <Text style={styles.dayHeader}>
                      {format(day, "EEEE, MMM d")}
                    </Text>
                    {dayShifts.map((shift) => {
                      const past = isPastShift(shift, todayKey, nowTime);
                      const tipStatus =
                        past && tipStatuses && shift.outlet_id && shift.date
                          ? tipStatuses.get(
                              shiftTipKey(shift.outlet_id, shift.date)
                            )
                          : undefined;
                      return (
                        <ShiftBlock
                          key={shift.id}
                          shift={shift}
                          tipStatus={tipStatus}
                          onDeclareTips={
                            shift.outlet_id && shift.date
                              ? () =>
                                  navigation.navigate("TipDeclaration", {
                                    outletId: shift.outlet_id!,
                                    outletName: shift.outlets?.name ?? null,
                                    shiftDate: shift.date!,
                                    position: shift.position,
                                  })
                              : undefined
                          }
                        />
                      );
                    })}
                  </View>
                );
              })
            )}

            <TeammatesSection
              teammates={state.teammates}
              open={teammatesOpen}
              onToggle={() => setTeammatesOpen((v) => !v)}
              weekLabel={weekLabel}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ShiftBlock({
  shift,
  tipStatus,
  onDeclareTips,
}: {
  shift: ScheduleShift;
  tipStatus?: TipStatus;
  onDeclareTips?: () => void;
}) {
  return (
    <View style={styles.shiftBlock}>
      <View style={styles.shiftHeaderRow}>
        <Text style={styles.shiftPosition}>{shift.position ?? "Shift"}</Text>
        {shift.shift_type && (
          <View style={styles.typePill}>
            <Text style={styles.typePillText}>{shift.shift_type}</Text>
          </View>
        )}
      </View>
      {shift.outlets?.name && (
        <Text style={styles.shiftOutlet}>{shift.outlets.name}</Text>
      )}
      <Text style={styles.shiftTime}>
        {formatShiftTime(shift.start_time)} – {formatShiftTime(shift.end_time)}
      </Text>
      {shift.notes ? <Text style={styles.shiftNotes}>{shift.notes}</Text> : null}
      {tipStatus && (
        <TipActionRow status={tipStatus} onPress={onDeclareTips} />
      )}
    </View>
  );
}

function TipActionRow({
  status,
  onPress,
}: {
  status: TipStatus;
  onPress?: () => void;
}) {
  if (!status.sheetExists) {
    return <Text style={styles.tipDim}>Tip sheet not yet open</Text>;
  }
  if (status.sheetStatus === "posted") {
    return (
      <Text style={styles.tipFinal}>
        Tips finalized
        {status.tipAmount !== null ? `: ${fmtUSD(status.tipAmount)}` : ""}
      </Text>
    );
  }
  if (!status.sheetOpen) {
    // 'ready' — computed, awaiting manager post; nothing to edit anymore.
    return (
      <Text style={styles.tipDim}>
        {status.rowId
          ? "Tips declared ✓ — pending manager review"
          : "Tip sheet closed for review"}
      </Text>
    );
  }
  if (!status.rowId) {
    return (
      <Pressable style={styles.tipDeclareButton} onPress={onPress}>
        <Text style={styles.tipDeclareButtonText}>Declare tips →</Text>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress}>
      <Text style={styles.tipDeclaredLink}>Tips declared ✓ · Edit</Text>
    </Pressable>
  );
}

function TeammatesSection({
  teammates,
  open,
  onToggle,
  weekLabel,
}: {
  teammates: TeammateShift[];
  open: boolean;
  onToggle: () => void;
  weekLabel: string;
}) {
  // Group the flat shift rows by teammate, keeping chronological order.
  const groups = useMemo(() => {
    const byId = new Map<string, { name: string; shifts: TeammateShift[] }>();
    for (const t of teammates) {
      const emp = t.employees;
      if (!emp) continue;
      const existing = byId.get(emp.id);
      if (existing) existing.shifts.push(t);
      else {
        byId.set(emp.id, {
          name: `${emp.first_name} ${emp.last_name}`,
          shifts: [t],
        });
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [teammates]);

  if (groups.length === 0) return null;

  return (
    <View style={styles.card}>
      <Pressable style={styles.teammatesHeader} onPress={onToggle}>
        <Text style={styles.dayHeader}>
          Teammates {weekLabel} ({groups.length})
        </Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.muted}
        />
      </Pressable>
      {open &&
        groups.map((group) => (
          <View key={group.name} style={styles.teammateGroup}>
            <Text style={styles.teammateName}>{group.name}</Text>
            {group.shifts.map((s) => (
              <Text key={s.id} style={styles.teammateShiftRow}>
                {[
                  s.position ?? "Shift",
                  s.date ? format(new Date(`${s.date}T00:00:00`), "EEE d") : "—",
                  `${formatShiftTime(s.start_time)}–${formatShiftTime(s.end_time)}`,
                  s.outlets?.name,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            ))}
          </View>
        ))}
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
          <Animated.View style={[styles.skeletonLine, { opacity: pulse, width: "45%" }]} />
          <Animated.View style={[styles.skeletonBlock, { opacity: pulse }]} />
          <Animated.View style={[styles.skeletonLine, { opacity: pulse, width: "65%" }]} />
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
  weekTabs: {
    flexDirection: "row",
    margin: 16,
    marginBottom: 4,
    backgroundColor: colors.border,
    borderRadius: 10,
    padding: 3,
  },
  weekTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  weekTabActive: {
    backgroundColor: colors.card,
  },
  weekTabText: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.muted,
  },
  weekTabTextActive: {
    color: colors.foreground,
  },
  content: {
    padding: 16,
    paddingTop: 12,
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
  dayHeader: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.foreground,
  },
  shiftBlock: {
    marginTop: 10,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    backgroundColor: colors.background,
    borderRadius: 8,
    padding: 12,
  },
  shiftHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  shiftPosition: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.foreground,
  },
  typePill: {
    backgroundColor: "rgba(45, 184, 122, 0.14)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  typePillText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.primaryDim,
  },
  shiftOutlet: {
    marginTop: 2,
    fontSize: 13,
    color: colors.muted,
  },
  shiftTime: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: "500",
    color: colors.foreground,
  },
  shiftNotes: {
    marginTop: 6,
    fontSize: 13,
    color: colors.muted,
    fontStyle: "italic",
  },
  tipDim: {
    marginTop: 8,
    fontSize: 13,
    color: colors.muted,
  },
  tipFinal: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
  },
  tipDeclareButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  tipDeclareButtonText: {
    color: colors.primaryOn,
    fontSize: 13,
    fontWeight: "600",
  },
  tipDeclaredLink: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: "600",
    color: colors.primaryDim,
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
  teammatesHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  teammateGroup: {
    marginTop: 12,
  },
  teammateName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: 3,
  },
  teammateShiftRow: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 2,
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

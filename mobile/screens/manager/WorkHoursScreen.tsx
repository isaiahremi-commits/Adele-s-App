import React, { useCallback, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { endOfISOWeek, format, startOfISOWeek } from "date-fns";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { formatTime12, titleCase } from "../../lib/format";
import {
  type RangeShift,
  getShiftsRange,
  shiftHours,
} from "../../lib/manager";
import { colors } from "../../lib/theme";

// Work-mode Hours tab (PR #18): projected hours per employee — today and
// week-to-date — from scheduled shift lengths (wall-clock start→end, the
// same math the web scheduler implies). Tap a row for the shift-by-shift
// breakdown. Projections, not punches: timecard truth stays on the web
// Timecards page and in the EOD wizard.

type Grouped = {
  employee_id: string;
  name: string;
  todayHours: number;
  weekHours: number;
  shifts: RangeShift[];
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: Grouped[] };

export default function WorkHoursScreen() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    const seq = ++requestSeq.current;
    if (mode === "initial") setState({ kind: "loading" });
    else setRefreshing(true);
    try {
      const now = new Date();
      const todayKey = format(now, "yyyy-MM-dd");
      const weekStart = format(startOfISOWeek(now), "yyyy-MM-dd");
      const weekEnd = format(endOfISOWeek(now), "yyyy-MM-dd");
      const shifts = await getShiftsRange(weekStart, weekEnd);
      const byEmp = new Map<string, Grouped>();
      for (const s of shifts) {
        if (!s.employee_id) continue;
        const g = byEmp.get(s.employee_id) ?? {
          employee_id: s.employee_id,
          name: `${s.first_name} ${s.last_name}`.trim(),
          todayHours: 0,
          weekHours: 0,
          shifts: [],
        };
        const h = shiftHours(s.start_time, s.end_time);
        // week-to-date = through today, not the whole scheduled week
        if (s.date && s.date <= todayKey) g.weekHours += h;
        if (s.date === todayKey) g.todayHours += h;
        g.shifts.push(s);
        byEmp.set(s.employee_id, g);
      }
      const rows = [...byEmp.values()].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      if (seq === requestSeq.current) setState({ kind: "ready", rows });
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
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(state.kind === "ready" ? "refresh" : "initial");
      // reload-on-focus only
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load])
  );

  const fmtH = (n: number) => `${Number(n.toFixed(2))}h`;

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
      <Text style={styles.header}>Projected hours</Text>
      <Text style={styles.subheader}>
        From the schedule — today and week-to-date. Punch truth lives in
        Timecards.
      </Text>

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
        <View style={styles.card}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, styles.thName]}>Employee</Text>
            <Text style={styles.th}>Today</Text>
            <Text style={styles.th}>Week</Text>
          </View>
          {state.rows.length === 0 ? (
            <Text style={styles.mutedBody}>No shifts scheduled this week.</Text>
          ) : (
            state.rows.map((r) => (
              <View key={r.employee_id} style={styles.rowWrap}>
                <Pressable
                  style={styles.row}
                  onPress={() =>
                    setOpenId((cur) =>
                      cur === r.employee_id ? null : r.employee_id
                    )
                  }
                >
                  <Text style={[styles.td, styles.tdName]}>{r.name}</Text>
                  <Text style={styles.td}>{fmtH(r.todayHours)}</Text>
                  <Text style={styles.td}>{fmtH(r.weekHours)}</Text>
                  <Ionicons
                    name={openId === r.employee_id ? "chevron-up" : "chevron-down"}
                    size={14}
                    color={colors.muted}
                  />
                </Pressable>
                {openId === r.employee_id &&
                  r.shifts.map((s) => (
                    <Text key={s.shift_id} style={styles.detailLine}>
                      {[
                        s.date
                          ? format(new Date(`${s.date}T00:00:00`), "EEE d")
                          : "—",
                        `${formatTime12(s.start_time)}–${formatTime12(s.end_time)}`,
                        `${Number(shiftHours(s.start_time, s.end_time).toFixed(2))}h`,
                        titleCase(s.position),
                        s.outlet_name,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  ))}
              </View>
            ))
          )}
        </View>
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
    gap: 8,
  },
  header: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.foreground,
  },
  subheader: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 4,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  tableHeader: {
    flexDirection: "row",
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingRight: 18,
  },
  th: {
    width: 62,
    fontSize: 11,
    fontWeight: "700",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    textAlign: "right",
  },
  thName: {
    flex: 1,
    textAlign: "left",
  },
  rowWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    gap: 4,
  },
  td: {
    width: 62,
    fontSize: 13,
    color: colors.foreground,
    textAlign: "right",
  },
  tdName: {
    flex: 1,
    fontWeight: "600",
    textAlign: "left",
  },
  detailLine: {
    fontSize: 12,
    color: colors.muted,
    paddingBottom: 6,
    paddingLeft: 4,
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

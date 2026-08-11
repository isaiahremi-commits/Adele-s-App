import React, { useCallback, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { format, subDays } from "date-fns";
import { useFocusEffect } from "@react-navigation/native";
import {
  type DaySheet,
  getPartiesForSheets,
  getSheetsForDate,
} from "../../lib/manager";
import { colors } from "../../lib/theme";

// Work-mode Sales tab (PR #18) — STOPGAP. Phase 1 has no sales/POS table,
// so "yesterday's sales" is what the tip system knows: per-outlet service
// charge + non-cash tips + large-party revenue. The liquor/beer/wine/food
// breakdown Adèle asked for needs a POS feed (flagged in build-status);
// this card is honest about being tip-sheet-derived.

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      sheets: DaySheet[];
      partyTotal: number;
      partyCount: number;
    };

function fmtUSD(n: number): string {
  return (
    "$" +
    n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export default function WorkSalesScreen() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const requestSeq = useRef(0);

  const yesterday = subDays(new Date(), 1);
  const yesterdayKey = format(yesterday, "yyyy-MM-dd");

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      const seq = ++requestSeq.current;
      if (mode === "initial") setState({ kind: "loading" });
      else setRefreshing(true);
      try {
        const sheets = await getSheetsForDate(yesterdayKey);
        const parties = await getPartiesForSheets(sheets.map((s) => s.id));
        if (seq === requestSeq.current) {
          setState({
            kind: "ready",
            sheets,
            partyTotal: parties.reduce((sum, p) => sum + p.revenue, 0),
            partyCount: parties.length,
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
    [yesterdayKey]
  );

  useFocusEffect(
    useCallback(() => {
      load(state.kind === "ready" ? "refresh" : "initial");
      // reload-on-focus only
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load])
  );

  const totals =
    state.kind === "ready"
      ? state.sheets.reduce(
          (acc, s) => ({
            sc: acc.sc + s.service_charge,
            nc: acc.nc + s.non_cash_tips,
          }),
          { sc: 0, nc: 0 }
        )
      : { sc: 0, nc: 0 };

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
      <Text style={styles.header}>
        Yesterday · {format(yesterday, "EEE, MMM d")}
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
        <>
          <View style={styles.card}>
            <Text style={styles.bigLabel}>Tip-system revenue</Text>
            <Text style={styles.bigNumber}>
              {fmtUSD(totals.sc + totals.nc + state.partyTotal)}
            </Text>
            <View style={styles.breakdownRow}>
              <Breakdown label="Service charge" value={fmtUSD(totals.sc)} />
              <Breakdown label="Non-cash tips" value={fmtUSD(totals.nc)} />
              <Breakdown
                label={`Large parties (${state.partyCount})`}
                value={fmtUSD(state.partyTotal)}
              />
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionLabel}>By outlet</Text>
            {state.sheets.length === 0 ? (
              <Text style={styles.mutedBody}>
                No tip sheets for yesterday yet.
              </Text>
            ) : (
              state.sheets.map((s, i) => (
                <View
                  key={s.id}
                  style={[styles.outletRow, i > 0 && styles.rowBorder]}
                >
                  <Text style={styles.outletName}>
                    {s.outlet_name ?? "Outlet"}
                  </Text>
                  <Text style={styles.outletValue}>
                    {fmtUSD(s.service_charge + s.non_cash_tips)}
                  </Text>
                </View>
              ))
            )}
          </View>

          <Text style={styles.stopgapNote}>
            Liquor / beer / wine / food breakdowns need a POS feed — not
            wired yet. These numbers come from tip sheets.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

function Breakdown({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.breakdownItem}>
      <Text style={styles.breakdownLabel}>{label}</Text>
      <Text style={styles.breakdownValue}>{value}</Text>
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
  header: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.foreground,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  bigLabel: {
    fontSize: 13,
    color: colors.muted,
  },
  bigNumber: {
    marginTop: 4,
    fontSize: 32,
    fontWeight: "700",
    color: colors.foreground,
  },
  breakdownRow: {
    flexDirection: "row",
    marginTop: 14,
    gap: 10,
  },
  breakdownItem: {
    flex: 1,
  },
  breakdownLabel: {
    fontSize: 11,
    color: colors.muted,
  },
  breakdownValue: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: 4,
  },
  outletRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  outletName: {
    fontSize: 14,
    color: colors.foreground,
  },
  outletValue: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  stopgapNote: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
    paddingHorizontal: 4,
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

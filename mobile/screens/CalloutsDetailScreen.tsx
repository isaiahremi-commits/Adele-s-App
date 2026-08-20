import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../components/Text";
import { format } from "date-fns";
import { colors } from "../lib/theme";
import { titleCase } from "../lib/format";
import {
  type MyCalloutOrOffer,
  getMyCalloutsAndCoverage,
} from "../lib/coverage";

// PR #27 item 10: read-only per-callout list, last 90 days — reached from
// the Pay tab's "Your standing" card. No actions.

const WINDOW_DAYS = 90;

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function fmt12h(t: string | null): string | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  const ampm = h >= 12 ? "pm" : "am";
  return `${((h + 11) % 12) + 1}:${m[2]} ${ampm}`;
}

export default function CalloutsDetailScreen() {
  const [rows, setRows] = useState<MyCalloutOrOffer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyCalloutsAndCoverage()
      .then((all) => {
        const since = daysAgoISO(WINDOW_DAYS);
        setRows(
          all.filter(
            (r) => r.kind === "callout" && (r.shift_date ?? "") >= since
          )
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load callouts"));
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.windowNote}>Last {WINDOW_DAYS} days</Text>
      {error && (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>Couldn&apos;t load callouts</Text>
          <Text style={styles.emptyBody}>{error}</Text>
        </View>
      )}
      {!error && rows === null && (
        <View style={styles.card}>
          <Text style={styles.emptyBody}>Loading…</Text>
        </View>
      )}
      {rows !== null && rows.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>No callouts</Text>
          <Text style={styles.emptyBody}>
            Nothing recorded in the last {WINDOW_DAYS} days.
          </Text>
        </View>
      )}
      {(rows ?? []).map((r) => {
        const time = [fmt12h(r.start_time), fmt12h(r.end_time)].filter(Boolean).join(" – ");
        const shiftBits = [
          time || null,
          r.shift_position ? titleCase(r.shift_position) : null,
          r.outlet_name ?? null,
        ].filter(Boolean);
        return (
          <View key={r.callout_id ?? `${r.shift_id}-${r.created_at}`} style={styles.card}>
            <Text style={styles.date}>
              {r.shift_date
                ? format(new Date(`${r.shift_date}T00:00:00`), "EEE, MMM d, yyyy")
                : "—"}
            </Text>
            {shiftBits.length > 0 && (
              <Text style={styles.shift}>{shiftBits.join(" · ")}</Text>
            )}
            <Text style={styles.reason}>
              {r.reason ? titleCase(r.reason) : "No reason recorded"}
            </Text>
          </View>
        );
      })}
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
  windowNote: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 2,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  date: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.foreground,
  },
  shift: {
    marginTop: 2,
    fontSize: 13,
    color: colors.muted,
  },
  reason: {
    marginTop: 6,
    fontSize: 14,
    color: colors.mutedStrong,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.foreground,
  },
  emptyBody: {
    marginTop: 4,
    fontSize: 14,
    color: colors.muted,
  },
});

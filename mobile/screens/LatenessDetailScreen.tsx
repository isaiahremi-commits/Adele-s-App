import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../components/Text";
import { format } from "date-fns";
import { colors } from "../lib/theme";
import {
  type LatenessIncident,
  getMyLatenessIncidents,
} from "../lib/pay";

// PR #27 item 10: read-only per-incident lateness list, last 90 days —
// reached from the Pay tab's "Your standing" card. No actions.

const WINDOW_DAYS = 90;

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function LatenessDetailScreen() {
  const [incidents, setIncidents] = useState<LatenessIncident[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyLatenessIncidents(daysAgoISO(WINDOW_DAYS), todayISO())
      .then(setIncidents)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load incidents"));
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.windowNote}>Last {WINDOW_DAYS} days</Text>
      {error && (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>Couldn&apos;t load incidents</Text>
          <Text style={styles.emptyBody}>{error}</Text>
        </View>
      )}
      {!error && incidents === null && (
        <View style={styles.card}>
          <Text style={styles.emptyBody}>Loading…</Text>
        </View>
      )}
      {incidents !== null && incidents.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>No lateness incidents</Text>
          <Text style={styles.emptyBody}>
            Nothing recorded in the last {WINDOW_DAYS} days. Keep it up!
          </Text>
        </View>
      )}
      {(incidents ?? []).map((i) => (
        <View key={i.timecard_id} style={styles.card}>
          <View style={styles.rowTop}>
            <Text style={styles.date}>
              {format(new Date(`${i.work_date}T00:00:00`), "EEE, MMM d, yyyy")}
            </Text>
            <View style={[styles.tierChip, i.lateness_tier >= 2 && styles.tierChipT2]}>
              <Text style={[styles.tierText, i.lateness_tier >= 2 && styles.tierTextT2]}>
                Tier {i.lateness_tier}
              </Text>
            </View>
          </View>
          <Text style={styles.minutes}>{i.minutes_late} min late</Text>
        </View>
      ))}
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
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  date: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.foreground,
  },
  minutes: {
    marginTop: 4,
    fontSize: 14,
    color: colors.mutedStrong,
  },
  tierChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: colors.warningSoft,
  },
  tierChipT2: {
    backgroundColor: colors.dangerSoft,
  },
  tierText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.amber,
  },
  tierTextT2: {
    color: colors.danger,
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

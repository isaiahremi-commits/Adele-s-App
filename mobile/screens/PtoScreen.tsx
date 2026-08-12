import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Animated,
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
import { useAuth } from "../contexts/AuthContext";
import type { PtoStackParamList } from "../lib/navigation";
import {
  type PtoRequest,
  type PtoStatus,
  getMyBalance,
  getMyRequests,
} from "../lib/pto";
import { colors } from "../lib/theme";
import PtoSubmitModal from "./PtoSubmitModal";

// PTO tab root: balance card, Pending/Approved/Denied tabs, request list,
// FAB to submit. Refetches on every focus, so returning from a detail-screen
// modify/cancel (or from the submit modal) always shows fresh rows.

const STATUS_TABS: PtoStatus[] = ["pending", "approved", "denied"];

function fmtDay(d: string): string {
  return format(new Date(`${d}T00:00:00`), "MMM d, yyyy");
}

export default function PtoScreen() {
  const { terminated } = useAuth();
  const navigation =
    useNavigation<NativeStackNavigationProp<PtoStackParamList, "PtoList">>();
  const [tab, setTab] = useState<PtoStatus>("pending");
  const [balance, setBalance] = useState<number | null>(null);
  const [requests, setRequests] = useState<PtoRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const requestSeq = useRef(0);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    const seq = ++requestSeq.current;
    if (mode === "initial") {
      setRequests(null);
      setError(null);
    } else {
      setRefreshing(true);
    }
    try {
      const [bal, reqs] = await Promise.all([getMyBalance(), getMyRequests()]);
      if (seq === requestSeq.current) {
        setBalance(bal);
        setRequests(reqs);
        setError(null);
      }
    } catch (e) {
      if (seq === requestSeq.current) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    } finally {
      if (seq === requestSeq.current) setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(requests === null ? "initial" : "refresh");
      // Refetch-on-focus only; no cleanup needed.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load])
  );

  const visible = useMemo(
    () => (requests ?? []).filter((r) => r.status === tab),
    [requests, tab]
  );

  const loading = requests === null && !error;

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

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>PTO balance</Text>
          <Text style={styles.balanceValue}>
            {balance === null ? "—" : `${Number(balance).toFixed(2)} h`}
          </Text>
          <Text style={styles.balanceHint}>hours available</Text>
        </View>

        <View style={styles.statusTabs}>
          {STATUS_TABS.map((s) => (
            <Pressable
              key={s}
              style={[styles.statusTab, tab === s && styles.statusTabActive]}
              onPress={() => setTab(s)}
            >
              <Text
                style={[
                  styles.statusTabText,
                  tab === s && styles.statusTabTextActive,
                ]}
              >
                {s[0].toUpperCase() + s.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        {loading && <SkeletonRows />}

        {error && (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>Couldn't load your PTO</Text>
            <Text style={styles.emptyBody}>{error}</Text>
            <Pressable style={styles.retryButton} onPress={() => load("initial")}>
              <Text style={styles.retryButtonText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {!loading && !error && visible.length === 0 && (
          <View style={styles.card}>
            <Text style={styles.emptyBody}>No {tab} requests</Text>
          </View>
        )}

        {visible.map((r) => (
          <Pressable
            key={r.id}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => navigation.navigate("PtoDetail", { request: r })}
          >
            <View style={styles.rowTop}>
              <Text style={styles.rowDates}>
                {fmtDay(r.start_date)} – {fmtDay(r.end_date)}
              </Text>
              <View style={styles.reasonChip}>
                <Text style={styles.reasonChipText}>{r.reason}</Text>
              </View>
            </View>
            <Text style={styles.rowMeta}>
              {Number(r.total_hours_requested).toFixed(0)} h · requested{" "}
              {format(new Date(r.requested_at), "MMM d")}
              {r.decided_at
                ? ` · decided ${format(new Date(r.decided_at), "MMM d")}`
                : ""}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* PR #20: grace-period accounts are read-only — no new requests. */}
      {!terminated && (
        <Pressable
          style={({ pressed }) => [styles.fab, pressed && styles.dim]}
          onPress={() => setSubmitOpen(true)}
          accessibilityLabel="Request PTO"
        >
          <Ionicons name="add" size={30} color={colors.primaryOn} />
        </Pressable>
      )}

      <PtoSubmitModal
        visible={submitOpen}
        editing={null}
        onClose={() => setSubmitOpen(false)}
        onSaved={() => {
          setSubmitOpen(false);
          setTab("pending");
          load("refresh");
        }}
      />
    </View>
  );
}

function SkeletonRows() {
  const pulse = useRef(new Animated.Value(0.35)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.card}>
          <Animated.View style={[styles.skeletonLine, { opacity: pulse, width: "60%" }]} />
          <Animated.View style={[styles.skeletonLine, { opacity: pulse, width: "40%" }]} />
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
    paddingBottom: 96, // keep the last row clear of the FAB
  },
  refreshingNote: {
    textAlign: "center",
    fontSize: 12,
    color: colors.muted,
  },
  balanceCard: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    padding: 20,
    alignItems: "center",
  },
  balanceLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "rgba(255, 255, 255, 0.85)",
  },
  balanceValue: {
    fontSize: 34,
    fontWeight: "700",
    color: colors.primaryOn,
    marginVertical: 2,
  },
  balanceHint: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.85)",
  },
  statusTabs: {
    flexDirection: "row",
    backgroundColor: colors.border,
    borderRadius: 10,
    padding: 3,
  },
  statusTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  statusTabActive: {
    backgroundColor: colors.card,
  },
  statusTabText: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.muted,
  },
  statusTabTextActive: {
    color: colors.foreground,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  cardPressed: {
    opacity: 0.75,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  rowDates: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "600",
    color: colors.foreground,
  },
  reasonChip: {
    backgroundColor: "rgba(45, 184, 122, 0.14)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  reasonChipText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.primaryDim,
  },
  rowMeta: {
    marginTop: 6,
    fontSize: 13,
    color: colors.muted,
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
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  dim: {
    opacity: 0.8,
  },
  skeletonLine: {
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.border,
    marginBottom: 8,
  },
});

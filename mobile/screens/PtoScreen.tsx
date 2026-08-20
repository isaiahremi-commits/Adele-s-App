import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Text } from "../components/Text";
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

// PR #27 item 3: list ordering, persisted per user/device.
type PtoSort = "recent" | "oldest" | "requested";
const SORT_KEY = "manadele.pto_sort_v1";
const SORT_LABELS: Record<PtoSort, string> = {
  recent: "Most recent",
  oldest: "Oldest",
  requested: "By date requested",
};

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
  const [sort, setSort] = useState<PtoSort>("recent");
  const [sortOpen, setSortOpen] = useState(false);
  const requestSeq = useRef(0);

  // Restore the persisted sort once; writes are fire-and-forget.
  useEffect(() => {
    AsyncStorage.getItem(SORT_KEY)
      .then((v) => {
        if (v === "recent" || v === "oldest" || v === "requested") setSort(v);
      })
      .catch(() => {});
  }, []);

  function pickSort(next: PtoSort) {
    setSort(next);
    setSortOpen(false);
    AsyncStorage.setItem(SORT_KEY, next).catch(() => {});
  }

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

  const visible = useMemo(() => {
    const rows = (requests ?? []).filter((r) => r.status === tab);
    // Server order is start_date desc ("recent"); the others re-sort here.
    if (sort === "oldest") {
      return [...rows].sort((a, b) => a.start_date.localeCompare(b.start_date));
    }
    if (sort === "requested") {
      return [...rows].sort((a, b) => (b.requested_at ?? "").localeCompare(a.requested_at ?? ""));
    }
    return rows;
  }, [requests, tab, sort]);

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

        {/* PR #27 item 3: sort dropdown (persisted). */}
        <Pressable style={styles.sortRow} onPress={() => setSortOpen(true)}>
          <Text style={styles.sortLabel}>Sort: {SORT_LABELS[sort]}</Text>
          <Ionicons name="chevron-down" size={14} color={colors.mutedStrong} />
        </Pressable>
        <Modal transparent visible={sortOpen} animationType="fade" onRequestClose={() => setSortOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSortOpen(false)}>
            <View style={styles.modalCard}>
              {(Object.keys(SORT_LABELS) as PtoSort[]).map((s) => (
                <Pressable key={s} style={styles.modalRow} onPress={() => pickSort(s)}>
                  <Text style={[styles.modalRowText, sort === s && styles.modalRowTextActive]}>
                    {SORT_LABELS[s]}
                  </Text>
                  {sort === s && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Modal>

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
  // PR #27 item 3: sort dropdown.
  sortRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  sortLabel: {
    fontSize: 13,
    color: colors.mutedStrong,
    fontWeight: "500",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: "center",
    padding: 32,
  },
  modalCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: 6,
  },
  modalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  modalRowText: {
    fontSize: 15,
    color: colors.foreground,
  },
  modalRowTextActive: {
    color: colors.primary,
    fontWeight: "600",
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
    backgroundColor: colors.infoSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  reasonChipText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.infoText,
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
    shadowColor: colors.shadow,
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

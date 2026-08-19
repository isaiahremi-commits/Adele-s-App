import React, { useCallback, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "../components/Text";
import { format } from "date-fns";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../App";
import { useAuth } from "../contexts/AuthContext";
import { useInbox } from "../contexts/InboxContext";
import {
  type InboxItem,
  type SentBroadcast,
  getInbox,
  getSentBroadcasts,
} from "../lib/broadcasts";
import { isManager } from "../lib/manager";
import { titleCase } from "../lib/format";
import { colors } from "../lib/theme";

// Broadcast inbox, opened from the header bell. Everyone gets Received;
// managers get a Received | Sent segmented view (Sent shows read/reply
// aggregates) plus a compose button.

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Segment = "received" | "sent";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; received: InboxItem[]; sent: SentBroadcast[] | null };

function when(iso: string): string {
  return format(new Date(iso), "MMM d · h:mm a");
}

export default function InboxScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const inboxCtx = useInbox();
  const [segment, setSegment] = useState<Segment>("received");
  const [managerView, setManagerView] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const requestSeq = useRef(0);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      const seq = ++requestSeq.current;
      if (mode === "initial") setState({ kind: "loading" });
      else setRefreshing(true);
      try {
        const mgr = user ? await isManager(user.id) : false;
        const [received, sent] = await Promise.all([
          getInbox(),
          mgr ? getSentBroadcasts() : Promise.resolve(null),
        ]);
        if (seq === requestSeq.current) {
          setManagerView(mgr);
          setState({ kind: "ready", received, sent });
          inboxCtx.refresh();
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
    // inboxCtx.refresh is stable enough for our purposes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user]
  );

  useFocusEffect(
    useCallback(() => {
      load(state.kind === "ready" ? "refresh" : "initial");
      // reload-on-focus only
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load])
  );

  return (
    <View style={styles.screen}>
      {managerView && (
        <View style={styles.segmentRow}>
          {(["received", "sent"] as const).map((s) => (
            <Pressable
              key={s}
              style={[styles.segment, segment === s && styles.segmentActive]}
              onPress={() => setSegment(s)}
            >
              <Text
                style={[
                  styles.segmentText,
                  segment === s && styles.segmentTextActive,
                ]}
              >
                {s === "received" ? "Received" : "Sent"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

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
            <Text style={styles.emptyTitle}>Couldn't load your inbox</Text>
            <Text style={styles.mutedBody}>{state.message}</Text>
            <Pressable style={styles.retryButton} onPress={() => load("initial")}>
              <Text style={styles.retryButtonText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {state.kind === "ready" && segment === "received" && (
          <>
            {state.received.length === 0 && (
              <View style={styles.card}>
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.mutedBody}>
                  Broadcasts from your manager will show up here.
                </Text>
              </View>
            )}
            {state.received.map((b) => (
              <Pressable
                key={b.broadcast_id}
                // PR #17: ONE unread affordance — the primary-green left
                // border (replaces the old bold-text + dot combo, which was
                // too subtle in the demo). Read cards keep the plain look.
                style={[
                  styles.card,
                  !b.is_read && !b.is_mine && styles.unreadCard,
                ]}
                onPress={() =>
                  navigation.navigate("BroadcastDetail", {
                    broadcastId: b.broadcast_id,
                  })
                }
              >
                <View style={styles.rowTop}>
                  <Text style={styles.sender}>
                    {b.is_mine ? "You" : titleCase(b.sender_name)}
                  </Text>
                  <Text style={styles.rowMeta}>{when(b.created_at)}</Text>
                </View>
                <Text style={styles.body} numberOfLines={2}>
                  {b.body}
                </Text>
                {b.reply_count > 0 && (
                  <Text style={styles.rowMeta}>
                    {b.reply_count} {b.reply_count === 1 ? "reply" : "replies"}
                  </Text>
                )}
              </Pressable>
            ))}
          </>
        )}

        {state.kind === "ready" && segment === "sent" && (
          <>
            {(state.sent ?? []).length === 0 && (
              <View style={styles.card}>
                <Text style={styles.emptyTitle}>Nothing sent yet</Text>
              </View>
            )}
            {(state.sent ?? []).map((b) => (
              <Pressable
                key={b.broadcast_id}
                style={styles.card}
                onPress={() =>
                  navigation.navigate("BroadcastDetail", {
                    broadcastId: b.broadcast_id,
                  })
                }
              >
                <Text style={styles.body} numberOfLines={2}>
                  {b.body}
                </Text>
                <Text style={styles.rowMeta}>
                  {when(b.created_at)} ·{" "}
                  {b.audience_type === "all" ? "everyone" : "selected"} · read{" "}
                  {b.read_count}/{b.total_audience_size}
                  {b.reply_count > 0
                    ? ` · ${b.reply_count} ${b.reply_count === 1 ? "reply" : "replies"}`
                    : ""}
                </Text>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>

      {managerView && (
        <Pressable
          // Root-stack screen — no tab bar below to absorb the home
          // indicator, so the FAB clears it itself.
          style={[styles.fab, { bottom: 24 + insets.bottom }]}
          onPress={() => navigation.navigate("ComposeBroadcast")}
          accessibilityLabel="New broadcast"
        >
          <Ionicons name="create-outline" size={24} color={colors.primaryOn} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  segmentRow: {
    flexDirection: "row",
    margin: 16,
    marginBottom: 4,
    backgroundColor: colors.border,
    borderRadius: 10,
    padding: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  segmentActive: {
    backgroundColor: colors.card,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.muted,
  },
  segmentTextActive: {
    color: colors.foreground,
  },
  content: {
    padding: 16,
    paddingTop: 12,
    gap: 10,
    paddingBottom: 90,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  unreadCard: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 3,
  },
  sender: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  rowMeta: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  body: {
    fontSize: 14,
    color: colors.foreground,
    lineHeight: 19,
  },
  mutedCenter: {
    textAlign: "center",
    color: colors.muted,
    marginTop: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: 6,
  },
  mutedBody: {
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
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: colors.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});

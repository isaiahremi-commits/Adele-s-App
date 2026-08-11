import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { format } from "date-fns";
import { Ionicons } from "@expo/vector-icons";
import { useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../App";
import { useAuth } from "../contexts/AuthContext";
import { useInbox } from "../contexts/InboxContext";
import {
  type ReadReceipt,
  type ThreadItem,
  getReadReceipts,
  getThread,
  markRead,
  reply,
} from "../lib/broadcasts";
import { isManager } from "../lib/manager";
import { titleCase } from "../lib/format";
import { colors } from "../lib/theme";
import { markThreadSeen } from "../lib/threadSeen";

// One broadcast: the message, its reply thread, and a composer. Opening it
// records the read receipt (first read wins). Managers additionally get the
// per-employee read receipts, collapsed by default.

type Route = RouteProp<RootStackParamList, "BroadcastDetail">;

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; thread: ThreadItem[]; receipts: ReadReceipt[] | null };

function when(iso: string): string {
  return format(new Date(iso), "MMM d · h:mm a");
}

export default function BroadcastDetailScreen() {
  const { params } = useRoute<Route>();
  const { user } = useAuth();
  const inboxCtx = useInbox();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const mgr = user ? await isManager(user.id) : false;
      const [thread, receipts] = await Promise.all([
        getThread(params.broadcastId),
        mgr
          ? getReadReceipts(params.broadcastId).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (seq === requestSeq.current) {
        setState({ kind: "ready", thread, receipts });
      }
    } catch (e) {
      if (seq === requestSeq.current) {
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : "Something went wrong",
        });
      }
    }
  }, [params.broadcastId, user]);

  useEffect(() => {
    load();
    // Opening the message IS the read — record the receipt AND the local
    // reply-seen cursor (PR #15 Bug 3), then refresh the bell.
    Promise.allSettled([
      markRead(params.broadcastId),
      markThreadSeen(params.broadcastId),
    ]).then(() => inboxCtx.refresh());
    // mount-only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.broadcastId]);

  async function onSend() {
    const body = draft.trim();
    if (body === "") return;
    setSending(true);
    setSendError(null);
    try {
      await reply(params.broadcastId, body);
      setDraft("");
      // Replying implies having seen the thread up to now — advance the
      // cursor so your own reply never lights your own bell.
      await markThreadSeen(params.broadcastId);
      await load();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  }

  const readCount =
    state.kind === "ready" && state.receipts
      ? state.receipts.filter((r) => r.read_at !== null).length
      : 0;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView contentContainerStyle={styles.content}>
        {state.kind === "loading" && (
          <ActivityIndicator color={colors.primary} style={styles.spinner} />
        )}

        {state.kind === "error" && (
          <View style={styles.card}>
            <Text style={styles.errorTitle}>Couldn't load this message</Text>
            <Text style={styles.mutedBody}>{state.message}</Text>
            <Pressable style={styles.sendButton} onPress={load}>
              <Text style={styles.sendButtonText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {state.kind === "ready" &&
          state.thread.map((item) => (
            <View
              key={item.item_id}
              style={[
                styles.card,
                item.kind === "broadcast" && styles.broadcastCard,
              ]}
            >
              <View style={styles.itemTop}>
                <Text style={styles.itemSender}>{titleCase(item.sender_name)}</Text>
                <Text style={styles.itemMeta}>{when(item.created_at)}</Text>
              </View>
              <Text style={styles.itemBody}>{item.body}</Text>
            </View>
          ))}

        {state.kind === "ready" && state.receipts && (
          <View style={styles.card}>
            <Pressable
              style={styles.receiptsHeader}
              onPress={() => setReceiptsOpen((v) => !v)}
            >
              <Text style={styles.itemSender}>
                Read receipts ({readCount}/{state.receipts.length})
              </Text>
              <Ionicons
                name={receiptsOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={colors.muted}
              />
            </Pressable>
            {receiptsOpen &&
              state.receipts.map((r) => (
                <View key={r.employee_id} style={styles.receiptRow}>
                  <Text style={styles.receiptName}>{titleCase(r.employee_name)}</Text>
                  <Text
                    style={[
                      styles.itemMeta,
                      r.read_at !== null && styles.receiptRead,
                    ]}
                  >
                    {r.read_at !== null ? `read ${when(r.read_at)}` : "unread"}
                  </Text>
                </View>
              ))}
          </View>
        )}
      </ScrollView>

      {sendError && <Text style={styles.sendError}>{sendError}</Text>}
      <View style={styles.composer}>
        <TextInput
          style={styles.composerInput}
          value={draft}
          onChangeText={setDraft}
          placeholder="Reply…"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={2000}
        />
        <Pressable
          style={[
            styles.sendButton,
            (sending || draft.trim() === "") && styles.sendDisabled,
          ]}
          disabled={sending || draft.trim() === ""}
          onPress={onSend}
        >
          <Text style={styles.sendButtonText}>
            {sending ? "…" : "Send"}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
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
  spinner: {
    marginTop: 24,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  broadcastCard: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  itemTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  itemSender: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  itemMeta: {
    fontSize: 12,
    color: colors.muted,
  },
  itemBody: {
    fontSize: 14,
    color: colors.foreground,
    lineHeight: 20,
  },
  receiptsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  receiptName: {
    fontSize: 13,
    color: colors.foreground,
  },
  receiptRead: {
    color: colors.primaryDim,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  composerInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxHeight: 110,
  },
  sendButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  sendDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: colors.primaryOn,
    fontSize: 14,
    fontWeight: "600",
  },
  sendError: {
    color: "#dc2626",
    fontSize: 13,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  errorTitle: {
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
});

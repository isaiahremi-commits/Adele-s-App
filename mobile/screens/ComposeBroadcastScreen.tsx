import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../App";
import { showToast } from "../components/Toast";
import { getAudienceEmployees, send } from "../lib/broadcasts";
import { friendly } from "../lib/errors";
import { colors } from "../lib/theme";

// Manager-only: compose a broadcast to everyone or a searched/multi-selected
// subset. broadcast_send re-verifies manager status + audience server-side.

type Nav = NativeStackNavigationProp<RootStackParamList, "ComposeBroadcast">;
type Audience = "all" | "subset";

const BODY_MAX = 2000;

export default function ComposeBroadcastScreen() {
  const navigation = useNavigation<Nav>();
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const [employees, setEmployees] = useState<
    { id: string; name: string; position: string | null }[] | null
  >(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Separate from the submit `error` so a failed roster load can't read as
  // a send failure (and vice versa). null = not failed.
  const [rosterError, setRosterError] = useState<string | null>(null);

  useEffect(() => {
    if (audience === "subset" && employees === null && rosterError === null) {
      getAudienceEmployees()
        .then(setEmployees)
        .catch((e) => setRosterError(friendly(e)));
    }
  }, [audience, employees, rosterError]);

  const filtered = useMemo(() => {
    if (!employees) return [];
    const q = search.trim().toLowerCase();
    if (q === "") return employees;
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.position ?? "").toLowerCase().includes(q)
    );
  }, [employees, search]);

  function togglePick(id: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSend() {
    const text = body.trim();
    if (text === "") {
      setError("Write a message first — the box above is empty.");
      return;
    }
    if (audience === "subset" && picked.size === 0) {
      setError("Pick at least one person from the list to send this to.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await send(
        text,
        audience,
        audience === "subset" ? [...picked] : undefined
      );
      showToast(
        audience === "all"
          ? "Broadcast sent to everyone."
          : `Broadcast sent to ${picked.size} ${picked.size === 1 ? "person" : "people"}.`
      );
      navigation.goBack();
    } catch (e) {
      setError(friendly(e));
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.label}>Message</Text>
        <TextInput
          style={styles.bodyInput}
          value={body}
          onChangeText={setBody}
          placeholder="What does the team need to know?"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={BODY_MAX}
          autoFocus
        />
        <Text style={styles.charCount}>
          {body.length}/{BODY_MAX}
        </Text>

        <Text style={styles.label}>Send to</Text>
        <View style={styles.audienceRow}>
          {(
            [
              { key: "all", label: "All employees" },
              { key: "subset", label: "Select employees" },
            ] as const
          ).map((opt) => (
            <Pressable
              key={opt.key}
              style={[styles.chip, audience === opt.key && styles.chipActive]}
              onPress={() => setAudience(opt.key)}
            >
              <Text
                style={[
                  styles.chipText,
                  audience === opt.key && styles.chipTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {audience === "subset" && (
          <View style={styles.pickerBlock}>
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name or position"
              placeholderTextColor={colors.muted}
            />
            {rosterError !== null ? (
              <View>
                <Text style={styles.errorText}>{rosterError}</Text>
                <Pressable
                  hitSlop={8}
                  onPress={() => setRosterError(null) /* retriggers the load */}
                >
                  <Text style={styles.retryLink}>Try again</Text>
                </Pressable>
              </View>
            ) : employees === null ? (
              <ActivityIndicator color={colors.primary} />
            ) : filtered.length === 0 ? (
              <Text style={styles.pickMeta}>
                {employees.length === 0
                  ? "No teammates found to message yet."
                  : "Nobody matches that search."}
              </Text>
            ) : (
              filtered.map((e) => (
                <Pressable
                  key={e.id}
                  style={styles.pickRow}
                  onPress={() => togglePick(e.id)}
                >
                  <Ionicons
                    name={picked.has(e.id) ? "checkbox" : "square-outline"}
                    size={20}
                    color={picked.has(e.id) ? colors.primary : colors.muted}
                  />
                  <View>
                    <Text style={styles.pickName}>{e.name}</Text>
                    {e.position ? (
                      <Text style={styles.pickMeta}>{e.position}</Text>
                    ) : null}
                  </View>
                </Pressable>
              ))
            )}
            {picked.size > 0 && (
              <Text style={styles.pickMeta}>
                {picked.size} selected
              </Text>
            )}
          </View>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Pressable
          style={[styles.sendButton, busy && styles.dim]}
          disabled={busy}
          onPress={onSend}
        >
          <Text style={styles.sendButtonText}>
            {busy ? "Sending..." : "Send broadcast"}
          </Text>
        </Pressable>
      </View>
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
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: 6,
    marginTop: 8,
  },
  bodyInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: 15,
    padding: 12,
    minHeight: 110,
    // Android-only prop; including it on web prints a deprecation warning.
    ...(Platform.OS === "android" ? { textAlignVertical: "top" as const } : {}),
  },
  charCount: {
    alignSelf: "flex-end",
    marginTop: 3,
    fontSize: 11,
    color: colors.muted,
  },
  audienceRow: {
    flexDirection: "row",
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.background,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: "rgba(45, 184, 122, 0.12)",
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.muted,
  },
  chipTextActive: {
    color: colors.primaryDim,
  },
  pickerBlock: {
    marginTop: 10,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 6,
  },
  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  pickName: {
    fontSize: 14,
    color: colors.foreground,
  },
  pickMeta: {
    fontSize: 12,
    color: colors.muted,
  },
  errorText: {
    marginTop: 10,
    fontSize: 13,
    color: colors.danger,
    lineHeight: 18,
  },
  retryLink: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: "600",
    color: colors.primary,
  },
  sendButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  dim: {
    opacity: 0.6,
  },
  sendButtonText: {
    color: colors.primaryOn,
    fontSize: 15,
    fontWeight: "600",
  },
});

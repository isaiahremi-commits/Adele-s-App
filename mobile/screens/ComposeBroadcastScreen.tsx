import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Text, TextInput } from "../components/Text";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../App";
import { showToast } from "../components/Toast";
import {
  type AudienceEmployee,
  getAudienceEmployees,
  send,
} from "../lib/broadcasts";
import { titleCase } from "../lib/format";
import { colors } from "../lib/theme";

// Manager-only: compose a broadcast to everyone or a searched/multi-selected
// subset, narrowable by department + position filter chips (PR #16 — Adèle:
// "message just the kitchen", "just the bartenders"). Filters only narrow
// the PICKER; the audience is still the explicit id set handed to
// broadcast_send, which re-verifies manager status + audience server-side.
// Filter/selection state lives in this screen, so it survives scrolling and
// resets when the compose screen closes (unmount), per the spec.

type Nav = NativeStackNavigationProp<RootStackParamList, "ComposeBroadcast">;
type Audience = "all" | "subset";

const BODY_MAX = 2000;

/** Distinct non-empty values of one employee field, alphabetical. */
function distinctValues(
  employees: AudienceEmployee[] | null,
  field: "department" | "position"
): string[] {
  if (!employees) return [];
  const seen = new Map<string, string>(); // lowercased → first-seen casing
  for (const e of employees) {
    const v = e[field]?.trim();
    if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export default function ComposeBroadcastScreen() {
  const navigation = useNavigation<Nav>();
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const [employees, setEmployees] = useState<AudienceEmployee[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  // Multi-select filter chips; empty set = "All" (no narrowing).
  const [deptFilter, setDeptFilter] = useState<Set<string>>(new Set());
  const [posFilter, setPosFilter] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (audience === "subset" && employees === null) {
      getAudienceEmployees()
        .then(setEmployees)
        .catch((e) =>
          setError(e instanceof Error ? e.message : "Couldn't load employees")
        );
    }
  }, [audience, employees]);

  const departments = useMemo(
    () => distinctValues(employees, "department"),
    [employees]
  );
  const positions = useMemo(
    () => distinctValues(employees, "position"),
    [employees]
  );

  // Departments AND positions AND search all intersect.
  const filtered = useMemo(() => {
    if (!employees) return [];
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (
        deptFilter.size > 0 &&
        !deptFilter.has((e.department ?? "").toLowerCase())
      ) {
        return false;
      }
      if (
        posFilter.size > 0 &&
        !posFilter.has((e.position ?? "").toLowerCase())
      ) {
        return false;
      }
      if (q === "") return true;
      return (
        e.name.toLowerCase().includes(q) ||
        (e.position ?? "").toLowerCase().includes(q)
      );
    });
  }, [employees, search, deptFilter, posFilter]);

  const allShownPicked =
    filtered.length > 0 && filtered.every((e) => picked.has(e.id));

  function togglePick(id: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Add every currently-shown employee to the audience (or remove them all). */
  function toggleAllShown() {
    setPicked((cur) => {
      const next = new Set(cur);
      if (allShownPicked) filtered.forEach((e) => next.delete(e.id));
      else filtered.forEach((e) => next.add(e.id));
      return next;
    });
  }

  function toggleFilter(
    setFn: React.Dispatch<React.SetStateAction<Set<string>>>,
    value: string | null // null = the "All" chip: clear the set
  ) {
    setFn((cur) => {
      if (value === null) return new Set();
      const key = value.toLowerCase();
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function onSend() {
    const text = body.trim();
    if (text === "") {
      setError("Write a message first");
      return;
    }
    if (audience === "subset" && picked.size === 0) {
      setError("Pick at least one recipient");
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
      setError(e instanceof Error ? e.message : "Something went wrong");
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
            {employees === null ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
                <FilterChipRow
                  label="Department"
                  options={departments}
                  selected={deptFilter}
                  onToggle={(v) => toggleFilter(setDeptFilter, v)}
                />
                <FilterChipRow
                  label="Position"
                  options={positions}
                  selected={posFilter}
                  onToggle={(v) => toggleFilter(setPosFilter, v)}
                  // Stored casing is mixed ("bar back", "Bartender") —
                  // display Title Case, filter on the raw value.
                  display={titleCase}
                />

                {filtered.length > 0 && (
                  <Pressable style={styles.allShownRow} onPress={toggleAllShown}>
                    <Ionicons
                      name={allShownPicked ? "checkbox" : "square-outline"}
                      size={20}
                      color={allShownPicked ? colors.primary : colors.muted}
                    />
                    <Text style={styles.allShownText}>
                      All shown ({filtered.length})
                    </Text>
                  </Pressable>
                )}

                {filtered.length === 0 ? (
                  <Text style={styles.pickMeta}>
                    No employees match these filters.
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
                        <Text style={styles.pickName}>{titleCase(e.name)}</Text>
                        {(e.position || e.department) && (
                          <Text style={styles.pickMeta}>
                            {[titleCase(e.position), e.department]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
                        )}
                      </View>
                    </Pressable>
                  ))
                )}

                <Text style={styles.sendingCount}>
                  Sending to {picked.size}{" "}
                  {picked.size === 1 ? "employee" : "employees"}
                </Text>
              </>
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

function FilterChipRow({
  label,
  options,
  selected,
  onToggle,
  display,
}: {
  label: string;
  options: string[];
  /** Lowercased selected values; empty = "All". */
  selected: Set<string>;
  onToggle: (value: string | null) => void;
  /** Display-only label transform (e.g. titleCase); raw value still filters. */
  display?: (value: string) => string;
}) {
  if (options.length === 0) return null;
  const allActive = selected.size === 0;
  return (
    <View style={styles.filterRow}>
      <Text style={styles.filterLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterChips}
      >
        <Pressable
          style={[styles.filterChip, allActive && styles.chipActive]}
          onPress={() => onToggle(null)}
        >
          <Text
            style={[styles.filterChipText, allActive && styles.chipTextActive]}
          >
            All
          </Text>
        </Pressable>
        {options.map((opt) => {
          const active = selected.has(opt.toLowerCase());
          return (
            <Pressable
              key={opt}
              style={[styles.filterChip, active && styles.chipActive]}
              onPress={() => onToggle(opt)}
            >
              <Text
                style={[styles.filterChipText, active && styles.chipTextActive]}
              >
                {display ? display(opt) : opt}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
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
    textAlignVertical: "top",
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
    backgroundColor: colors.primarySoft,
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
  filterRow: {
    marginBottom: 8,
  },
  filterLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  filterChips: {
    flexDirection: "row",
    gap: 6,
    paddingRight: 8,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
    backgroundColor: colors.background,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "500",
    color: colors.muted,
  },
  allShownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  allShownText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
  },
  sendingCount: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: "600",
    color: colors.primaryDim,
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
  sendButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 14,
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

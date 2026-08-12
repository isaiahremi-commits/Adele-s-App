import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "../components/Text";
import { format } from "date-fns";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { showToast } from "../components/Toast";
import type { ScheduleStackParamList } from "../lib/navigation";
import { formatShiftTime } from "../lib/schedule";
import {
  type EligibleTeammate,
  getEligibleTeammates,
  submitSwapRequest,
} from "../lib/swaps";
import { titleCase } from "../lib/format";
import { colors } from "../lib/theme";

// Request a 1-to-1 swap for one of MY shifts: pick an eligible teammate
// (same position, same outlet, free during the shift — server-computed),
// optionally pick which of THEIR shifts to trade for ("any" otherwise),
// review the summary, submit. Target consent + manager approval follow.

type Nav = NativeStackNavigationProp<ScheduleStackParamList, "SwapRequest">;
type Route = RouteProp<ScheduleStackParamList, "SwapRequest">;

const ANY_SHIFT = "__any__";

function fmtDay(d: string): string {
  return format(new Date(`${d}T00:00:00`), "EEE, MMM d");
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; teammates: EligibleTeammate[] };

export default function SwapRequestScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [teammateId, setTeammateId] = useState<string | null>(null);
  const [shiftChoice, setShiftChoice] = useState<string>(ANY_SHIFT);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setState({ kind: "loading" });
    try {
      const teammates = await getEligibleTeammates(params.shiftId);
      if (seq === requestSeq.current) setState({ kind: "ready", teammates });
    } catch (e) {
      if (seq === requestSeq.current) {
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : "Something went wrong",
        });
      }
    }
  }, [params.shiftId]);

  useEffect(() => {
    load();
  }, [load]);

  const teammates = state.kind === "ready" ? state.teammates : [];
  const selected = teammates.find((t) => t.employee_id === teammateId) ?? null;
  const selectedShift =
    selected?.shifts.find((s) => s.shift_id === shiftChoice) ?? null;

  async function onSubmit() {
    if (!selected) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await submitSwapRequest(
        params.shiftId,
        selected.employee_id,
        shiftChoice === ANY_SHIFT ? undefined : shiftChoice
      );
      showToast(
        `Swap request sent to ${titleCase(selected.employee_name)} — manager approval follows.`
      );
      navigation.goBack();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.headerDate}>{fmtDay(params.shiftDate)}</Text>
        <Text style={styles.headerMeta}>
          {`${formatShiftTime(params.startTime)} – ${formatShiftTime(params.endTime)}`}
          {[params.position, params.outletName].filter(Boolean).length > 0
            ? ` · ${[titleCase(params.position), params.outletName].filter(Boolean).join(" · ")}`
            : ""}
        </Text>
        <Text style={styles.headerHint}>
          This is the shift you're giving away.
        </Text>
      </View>

      {state.kind === "loading" && (
        <View style={[styles.card, styles.centered]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {state.kind === "error" && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Couldn't load teammates</Text>
          <Text style={styles.mutedBody}>{state.message}</Text>
          <Pressable style={styles.submitButton} onPress={load}>
            <Text style={styles.submitButtonText}>Try again</Text>
          </Pressable>
        </View>
      )}

      {state.kind === "ready" && teammates.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>No eligible teammates</Text>
          <Text style={styles.mutedBody}>
            Nobody with your position at this outlet is free during this
            shift. Talk to your manager if you can't work it.
          </Text>
        </View>
      )}

      {state.kind === "ready" && teammates.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Pick a teammate to swap with</Text>
          {teammates.map((t) => {
            const active = t.employee_id === teammateId;
            return (
              <View key={t.employee_id}>
                <Pressable
                  style={[styles.teammateRow, active && styles.teammateRowActive]}
                  onPress={() => {
                    setTeammateId(active ? null : t.employee_id);
                    setShiftChoice(ANY_SHIFT);
                    setFormError(null);
                  }}
                >
                  <View style={styles.teammateInfo}>
                    <Text style={styles.teammateName}>{titleCase(t.employee_name)}</Text>
                    <Text style={styles.teammateMeta}>
                      {t.employee_position ?? "—"} ·{" "}
                      {t.shifts.length === 0
                        ? "no upcoming shifts"
                        : `${t.shifts.length} upcoming ${
                            t.shifts.length === 1 ? "shift" : "shifts"
                          }`}
                    </Text>
                  </View>
                  <Ionicons
                    name={active ? "radio-button-on" : "radio-button-off"}
                    size={20}
                    color={active ? colors.primary : colors.muted}
                  />
                </Pressable>

                {active && (
                  <View style={styles.shiftPicker}>
                    <Text style={styles.shiftPickerLabel}>
                      Trade for which of their shifts?
                    </Text>
                    <Choice
                      label="Any of their shifts"
                      sub="Your manager picks at approval"
                      active={shiftChoice === ANY_SHIFT}
                      onPress={() => setShiftChoice(ANY_SHIFT)}
                    />
                    {t.shifts.map((s) => (
                      <Choice
                        key={s.shift_id}
                        label={`${fmtDay(s.shift_date)} · ${formatShiftTime(s.start_time)}–${formatShiftTime(s.end_time)}`}
                        sub={[titleCase(s.shift_position), s.outlet_name]
                          .filter(Boolean)
                          .join(" · ")}
                        active={shiftChoice === s.shift_id}
                        onPress={() => setShiftChoice(s.shift_id)}
                      />
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {selected && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Summary</Text>
          <Text style={styles.summaryText}>
            You'll trade your {fmtDay(params.shiftDate)} shift (
            {formatShiftTime(params.startTime)}–{formatShiftTime(params.endTime)}
            ) for{" "}
            {selectedShift
              ? `${titleCase(selected.employee_name)}'s ${fmtDay(selectedShift.shift_date)} shift (${formatShiftTime(selectedShift.start_time)}–${formatShiftTime(selectedShift.end_time)})`
              : `any of ${titleCase(selected.employee_name)}'s shifts`}
            , pending {titleCase(selected.employee_name)}'s and your manager's approval.
          </Text>
          {formError && <Text style={styles.errorText}>{formError}</Text>}
          <Pressable
            style={[styles.submitButton, submitting && styles.submitDisabled]}
            disabled={submitting}
            onPress={onSubmit}
          >
            <Text style={styles.submitButtonText}>
              {submitting ? "Sending..." : "Send swap request"}
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

function Choice({
  label,
  sub,
  active,
  onPress,
}: {
  label: string;
  sub?: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.choiceRow, active && styles.choiceRowActive]}
      onPress={onPress}
    >
      <View style={styles.teammateInfo}>
        <Text style={[styles.choiceLabel, active && styles.choiceLabelActive]}>
          {label}
        </Text>
        {sub ? <Text style={styles.teammateMeta}>{sub}</Text> : null}
      </View>
      <Ionicons
        name={active ? "radio-button-on" : "radio-button-off"}
        size={18}
        color={active ? colors.primary : colors.muted}
      />
    </Pressable>
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
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  centered: {
    alignItems: "center",
  },
  headerDate: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.foreground,
  },
  headerMeta: {
    marginTop: 2,
    fontSize: 14,
    color: colors.muted,
  },
  headerHint: {
    marginTop: 6,
    fontSize: 12,
    color: colors.muted,
    fontStyle: "italic",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: 8,
  },
  mutedBody: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
  },
  teammateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  teammateRowActive: {},
  teammateInfo: {
    flexShrink: 1,
    paddingRight: 10,
  },
  teammateName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  teammateMeta: {
    marginTop: 1,
    fontSize: 12,
    color: colors.muted,
  },
  shiftPicker: {
    marginLeft: 8,
    marginBottom: 8,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
  shiftPickerLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
    marginBottom: 4,
  },
  choiceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 7,
  },
  choiceRowActive: {},
  choiceLabel: {
    fontSize: 13,
    color: colors.foreground,
  },
  choiceLabelActive: {
    fontWeight: "600",
  },
  summaryText: {
    fontSize: 14,
    color: colors.foreground,
    lineHeight: 21,
  },
  errorText: {
    marginTop: 10,
    fontSize: 13,
    color: colors.danger,
    lineHeight: 18,
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 12,
  },
  submitDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: colors.primaryOn,
    fontSize: 15,
    fontWeight: "600",
  },
});

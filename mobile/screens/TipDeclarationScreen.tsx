import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { format } from "date-fns";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { showToast } from "../components/Toast";
import { useAuth } from "../contexts/AuthContext";
import type { ScheduleStackParamList } from "../lib/navigation";
import { type TipStatus, getTipStatus, submitTipDeclaration } from "../lib/tips";
import { titleCase } from "../lib/format";
import { colors } from "../lib/theme";

// Declare (or edit) the signed-in employee's raw tip numbers for one worked
// shift: service charges, non-cash tips, and large-party revenue. Tip-outs
// are NOT entered here — the manager's formula (outlet_roles config) applies
// them at compute time. Server-side, tip_declaration_submit verifies the
// pending sheet + an approved timecard at this outlet/date.

type Nav = NativeStackNavigationProp<ScheduleStackParamList, "TipDeclaration">;
type Route = RouteProp<ScheduleStackParamList, "TipDeclaration">;

/** "$1,234.50" / "1234.5" / "" → number; NaN when not parseable. */
function parseAmount(s: string): number {
  const cleaned = s.replace(/[$,\s]/g, "");
  if (cleaned === "") return NaN;
  return Number(cleaned);
}

function fmtUSD(n: number): string {
  return (
    "$" +
    n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; status: TipStatus };

export default function TipDeclarationScreen() {
  const navigation = useNavigation<Nav>();
  const { isTipped } = useAuth();
  const { params } = useRoute<Route>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [sc, setSc] = useState("");
  const [nc, setNc] = useState("");
  const [lp, setLp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setState({ kind: "loading" });
    try {
      const status = await getTipStatus(params.outletId, params.shiftDate);
      if (seq !== requestSeq.current) return;
      setState({ kind: "ready", status });
      // Edit mode: pre-fill with what's already declared.
      if (status.rowId) {
        setSc(status.declaredServiceCharge?.toFixed(2) ?? "");
        setNc(status.declaredNonCash?.toFixed(2) ?? "");
        setLp(
          status.declaredLargeParty && status.declaredLargeParty > 0
            ? status.declaredLargeParty.toFixed(2)
            : ""
        );
      }
    } catch (e) {
      if (seq === requestSeq.current) {
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : "Something went wrong",
        });
      }
    }
  }, [params.outletId, params.shiftDate]);

  useEffect(() => {
    load();
  }, [load]);

  const editing = state.kind === "ready" && state.status.rowId !== null;

  async function onSubmit() {
    const scNum = parseAmount(sc);
    const ncNum = parseAmount(nc);
    const lpNum = lp.trim() === "" ? 0 : parseAmount(lp);
    if (!Number.isFinite(scNum) || scNum < 0) {
      setFormError("Service charges must be a number, zero or greater.");
      return;
    }
    if (!Number.isFinite(ncNum) || ncNum < 0) {
      setFormError("Non-cash tips must be a number, zero or greater.");
      return;
    }
    if (!Number.isFinite(lpNum) || lpNum < 0) {
      setFormError("Large-party revenue must be a number, zero or greater.");
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await submitTipDeclaration(
        params.outletId,
        params.shiftDate,
        scNum,
        ncNum,
        lpNum
      );
      showToast(editing ? "Tip declaration updated" : "Tips declared");
      navigation.goBack();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  const dateLabel = format(
    new Date(`${params.shiftDate}T00:00:00`),
    "EEEE, MMM d, yyyy"
  );

  // Defense in depth (PR #16): the Schedule tab never links here for a
  // non-tipped user, but a stale navigation state could — show a read-only
  // note instead of the declaration form.
  if (!isTipped) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.headerDate}>{dateLabel}</Text>
          <Text style={styles.headerMeta}>
            {[params.outletName, titleCase(params.position)].filter(Boolean).join(" · ") ||
              "Shift"}
          </Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.errorTitle}>Not on the tip roster</Text>
          <Text style={styles.mutedBody}>
            You're not currently on the tip roster — talk to your manager.
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.headerDate}>{dateLabel}</Text>
        <Text style={styles.headerMeta}>
          {[params.outletName, titleCase(params.position)].filter(Boolean).join(" · ") ||
            "Shift"}
        </Text>
      </View>

      {state.kind === "loading" && (
        <View style={[styles.card, styles.centered]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {state.kind === "error" && (
        <View style={styles.card}>
          <Text style={styles.errorTitle}>Couldn't load this tip sheet</Text>
          <Text style={styles.mutedBody}>{state.message}</Text>
          <Pressable style={styles.submitButton} onPress={load}>
            <Text style={styles.submitButtonText}>Try again</Text>
          </Pressable>
        </View>
      )}

      {state.kind === "ready" && !state.status.sheetOpen && (
        <View style={styles.card}>
          {state.status.sheetStatus === "posted" ? (
            <>
              <Text style={styles.errorTitle}>Tips finalized</Text>
              <Text style={styles.mutedBody}>
                This sheet is posted and locked.
                {state.status.tipAmount !== null
                  ? ` Your tips for this shift: ${fmtUSD(state.status.tipAmount)}.`
                  : ""}
              </Text>
            </>
          ) : state.status.sheetExists ? (
            <>
              <Text style={styles.errorTitle}>Closed for review</Text>
              <Text style={styles.mutedBody}>
                Your manager is reviewing this tip sheet — declarations can't
                be changed right now.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.errorTitle}>Tip sheet not yet open</Text>
              <Text style={styles.mutedBody}>
                Your manager hasn't created the tip sheet for this shift yet.
                Check back later.
              </Text>
            </>
          )}
        </View>
      )}

      {state.kind === "ready" && state.status.sheetOpen && (
        <>
          <View style={styles.card}>
            <AmountField
              label="Service charges (SC)"
              value={sc}
              onChange={setSc}
              autoFocus={!editing}
            />
            <AmountField
              label="Non-cash tips (NC)"
              value={nc}
              onChange={setNc}
            />
            <AmountField
              label="Large-party revenue"
              hint="Only if you served a large party this shift"
              value={lp}
              onChange={setLp}
            />
            {formError && <Text style={styles.formError}>{formError}</Text>}
            <Pressable
              style={[styles.submitButton, submitting && styles.submitDisabled]}
              disabled={submitting}
              onPress={onSubmit}
            >
              <Text style={styles.submitButtonText}>
                {submitting
                  ? "Submitting..."
                  : editing
                    ? "Update declaration"
                    : "Declare tips"}
              </Text>
            </Pressable>
          </View>

          <View style={[styles.card, styles.infoCard]}>
            <Ionicons
              name="information-circle-outline"
              size={18}
              color={colors.muted}
            />
            <Text style={styles.infoText}>
              Tip-outs to other positions are calculated automatically by your
              manager's tip formula — you don't enter those here.
            </Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function AmountField({
  label,
  hint,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      <View style={styles.inputWrap}>
        <Text style={styles.inputPrefix}>$</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          onBlur={() => {
            const n = parseAmount(value);
            if (Number.isFinite(n) && n >= 0) onChange(n.toFixed(2));
          }}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={colors.muted}
          autoFocus={autoFocus}
        />
      </View>
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
  field: {
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: 2,
  },
  fieldHint: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 4,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    marginTop: 4,
  },
  inputPrefix: {
    fontSize: 16,
    color: colors.muted,
    marginRight: 4,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.foreground,
    paddingVertical: 10,
  },
  formError: {
    fontSize: 13,
    color: "#dc2626",
    marginBottom: 10,
    lineHeight: 18,
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 4,
  },
  submitDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: colors.primaryOn,
    fontSize: 15,
    fontWeight: "600",
  },
  infoCard: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    backgroundColor: colors.background,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
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

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Text, TextInput } from "../../components/Text";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { format } from "date-fns";
import { useFocusEffect } from "@react-navigation/native";
import { showToast } from "../../components/Toast";
import { useAuth } from "../../contexts/AuthContext";
import {
  type DaySheet,
  type DayTimecard,
  type RangeShift,
  type SheetRow,
  addSheetRow,
  approveTimecard,
  computeTipSheet,
  getActiveEmployees,
  getEodReport,
  getPartiesForSheets,
  getSheetRows,
  getSheetsForDate,
  getShiftsRange,
  getTimecardsForDate,
  postTipSheet,
  shiftHours,
  submitEodReport,
  updateDeclared,
} from "../../lib/manager";
import { getCurrentEmployee } from "../../lib/schedule";
import { titleCase } from "../../lib/format";
import { colors } from "../../lib/theme";

// End-of-day wizard (PR #18): Hours → Tips → Sales → Notes → Submit.
//   1 Hours — projected (schedule) vs actual (timecards) per person;
//     "Approve all complete" runs tc_approve on pending, punch-complete
//     cards (missing punches stay web-fix, same rule as the inbox).
//   2 Tips — declared amounts per row; inline adjustments write
//     declared_service_charge/_non_cash (manager RLS); "Add team member"
//     drops a walk-in onto a sheet; Approve runs ts_compute per pending
//     sheet (locks employee edits, statuses → ready).
//   3 Sales — large-party sanity check against the POS.
//   4 Notes — free text for the day.
//   5 Submit — ts_post every ready sheet, write the eod_reports row
//     (UNIQUE per tenant+day — the "day locked" signal), clear the draft.
// Step + notes survive backgrounding via AsyncStorage (per-date key); a
// submitted eod_reports row renders the done state instead of the wizard.

const STEPS = ["Hours", "Tips", "Sales", "Notes", "Submit"] as const;
const draftKey = (date: string) => `eod_draft:${date}`;

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
  | { kind: "done"; notes: string | null }
  | { kind: "idle" }
  | { kind: "wizard" };

export default function EndOfDayScreen() {
  const { user } = useAuth();
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [step, setStep] = useState(0);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // step data
  const [timecards, setTimecards] = useState<DayTimecard[]>([]);
  const [shifts, setShifts] = useState<RangeShift[]>([]);
  const [sheets, setSheets] = useState<DaySheet[]>([]);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [parties, setParties] = useState<
    { id: string; revenue: number; notes: string | null }[]
  >([]);
  const [adjusting, setAdjusting] = useState<SheetRow | null>(null);
  const [adjSc, setAdjSc] = useState("");
  const [adjNc, setAdjNc] = useState("");
  const [adding, setAdding] = useState<string | null>(null); // sheet id
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>(
    []
  );
  const requestSeq = useRef(0);

  const loadDay = useCallback(async () => {
    const [tcs, shs, shts] = await Promise.all([
      getTimecardsForDate(todayKey),
      getShiftsRange(todayKey, todayKey),
      getSheetsForDate(todayKey),
    ]);
    const [rws, pts] = await Promise.all([
      getSheetRows(shts.map((s) => s.id)),
      getPartiesForSheets(shts.map((s) => s.id)),
    ]);
    setTimecards(tcs);
    setShifts(shs);
    setSheets(shts);
    setRows(rws);
    setParties(pts);
  }, [todayKey]);

  const boot = useCallback(async () => {
    const seq = ++requestSeq.current;
    setState({ kind: "loading" });
    try {
      const report = await getEodReport(todayKey).catch(() => null);
      if (report) {
        if (seq === requestSeq.current)
          setState({ kind: "done", notes: report.notes });
        return;
      }
      const raw = await AsyncStorage.getItem(draftKey(todayKey)).catch(
        () => null
      );
      if (raw) {
        try {
          const draft = JSON.parse(raw) as { step?: number; notes?: string };
          setStep(Math.min(Math.max(draft.step ?? 0, 0), STEPS.length - 1));
          setNotes(draft.notes ?? "");
          await loadDay();
          if (seq === requestSeq.current) setState({ kind: "wizard" });
          return;
        } catch {
          /* corrupt draft — fall through to idle */
        }
      }
      if (seq === requestSeq.current) setState({ kind: "idle" });
    } catch (e) {
      if (seq === requestSeq.current) {
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : "Something went wrong",
        });
      }
    }
  }, [todayKey, loadDay]);

  useFocusEffect(
    useCallback(() => {
      boot();
    }, [boot])
  );

  // Persist the draft whenever step/notes move while the wizard is open.
  useEffect(() => {
    if (state.kind !== "wizard") return;
    AsyncStorage.setItem(
      draftKey(todayKey),
      JSON.stringify({ step, notes })
    ).catch(() => {});
  }, [state.kind, step, notes, todayKey]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await loadDay();
      setStep(0);
      setState({ kind: "wizard" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  // step 1: approve every pending, punch-complete timecard
  async function approveHours() {
    setBusy(true);
    setError(null);
    try {
      const targets = timecards.filter(
        (t) => t.status === "pending" && !t.missing_punch
      );
      for (const t of targets) {
        await approveTimecard(t.id);
      }
      showToast(
        targets.length === 0
          ? "Nothing pending to approve."
          : `${targets.length} timecard${targets.length === 1 ? "" : "s"} approved.`
      );
      await loadDay();
      setStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  // step 2: compute every pending sheet
  async function approveTips() {
    setBusy(true);
    setError(null);
    try {
      for (const s of sheets.filter((x) => x.status === "pending")) {
        await computeTipSheet(s.id);
      }
      await loadDay();
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function saveAdjustment() {
    if (!adjusting) return;
    const sc = Number(adjSc);
    const nc = Number(adjNc);
    if (!Number.isFinite(sc) || sc < 0 || !Number.isFinite(nc) || nc < 0) {
      setError("Amounts must be zero or greater.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateDeclared(adjusting.row_id, sc, nc);
      showToast(`Adjusted ${adjusting.name}'s declaration.`);
      setAdjusting(null);
      await loadDay();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function openAddMember(sheetId: string) {
    setAdding(sheetId);
    if (employees.length === 0) {
      setEmployees(await getActiveEmployees().catch(() => []));
    }
  }

  async function addMember(employeeId: string) {
    if (!adding) return;
    setBusy(true);
    setError(null);
    try {
      await addSheetRow(adding, employeeId);
      showToast("Team member added to the sheet.");
      setAdding(null);
      await loadDay();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  // step 5: post ready sheets + write the report + clear draft
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const fresh = await getSheetsForDate(todayKey);
      for (const s of fresh.filter((x) => x.status === "ready")) {
        await postTipSheet(s.id);
      }
      const me = user
        ? await getCurrentEmployee(user.id).catch(() => null)
        : null;
      await submitEodReport(todayKey, notes, me?.id ?? null);
      await AsyncStorage.removeItem(draftKey(todayKey)).catch(() => {});
      showToast("End-of-day submitted — the day is locked.");
      setState({ kind: "done", notes: notes.trim() || null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  // ── derived, per-step ────────────────────────────────────────────────────
  const projectedByEmp = new Map<string, number>();
  for (const s of shifts) {
    projectedByEmp.set(
      s.employee_id,
      (projectedByEmp.get(s.employee_id) ?? 0) +
        shiftHours(s.start_time, s.end_time)
    );
  }
  const partyTotal = parties.reduce((sum, p) => sum + p.revenue, 0);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.header}>
        End of day · {format(new Date(), "EEE, MMM d")}
      </Text>

      {state.kind === "loading" && (
        <Text style={styles.mutedCenter}>Loading…</Text>
      )}

      {state.kind === "error" && (
        <View style={styles.card}>
          <Text style={styles.mutedBody}>{state.message}</Text>
          <Pressable style={styles.primaryButton} onPress={boot}>
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      )}

      {state.kind === "done" && (
        <View style={styles.card}>
          <Text style={styles.doneTitle}>✓ Day locked</Text>
          <Text style={styles.mutedBody}>
            Today's end-of-day report is submitted.
            {state.notes ? `\n\n"${state.notes}"` : ""}
          </Text>
        </View>
      )}

      {state.kind === "idle" && (
        <View style={styles.card}>
          <Text style={styles.mutedBody}>
            Walk the close in five steps: team hours, tips, sales, notes,
            submit. You can background the app mid-flow — it picks up where
            you left off.
          </Text>
          {error && <Text style={styles.errorText}>{error}</Text>}
          <Pressable
            style={[styles.primaryButton, busy && styles.dim]}
            disabled={busy}
            onPress={start}
          >
            <Text style={styles.primaryButtonText}>
              {busy ? "Loading..." : "Start end-of-day report"}
            </Text>
          </Pressable>
        </View>
      )}

      {state.kind === "wizard" && (
        <>
          {/* step indicator */}
          <View style={styles.stepsRow}>
            {STEPS.map((s, i) => (
              <Pressable
                key={s}
                style={styles.stepChipWrap}
                disabled={i > step}
                onPress={() => setStep(i)}
              >
                <Text
                  style={[
                    styles.stepChip,
                    i === step && styles.stepChipActive,
                    i < step && styles.stepChipDone,
                  ]}
                >
                  {i < step ? "✓ " : ""}
                  {s}
                </Text>
              </Pressable>
            ))}
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}

          {step === 0 && (
            <View style={styles.card}>
              <Text style={styles.stepTitle}>Team hours</Text>
              <Text style={styles.stepHint}>
                Projected (schedule) vs actual (punches). Missing punches are
                fixed on the web Timecards page.
              </Text>
              {timecards.length === 0 && (
                <Text style={styles.mutedBody}>No timecards today yet.</Text>
              )}
              {timecards.map((t, i) => (
                <View
                  key={t.id}
                  style={[styles.dataRow, i > 0 && styles.rowBorder]}
                >
                  <Text style={styles.dataName}>{titleCase(t.name)}</Text>
                  <Text style={styles.dataMeta}>
                    {t.missing_punch
                      ? "⚠ missing punch"
                      : `${Number((t.regular_hours + t.ot_hours).toFixed(2))}h actual`}
                    {" · "}
                    {Number(
                      (projectedByEmp.get(t.employee_id) ?? 0).toFixed(2)
                    )}
                    h projected · {t.status}
                  </Text>
                </View>
              ))}
              <Pressable
                style={[styles.primaryButton, busy && styles.dim]}
                disabled={busy}
                onPress={approveHours}
              >
                <Text style={styles.primaryButtonText}>
                  {busy ? "Working..." : "Approve complete timecards →"}
                </Text>
              </Pressable>
            </View>
          )}

          {step === 1 && (
            <View style={styles.card}>
              <Text style={styles.stepTitle}>Tips</Text>
              {sheets.length === 0 && (
                <Text style={styles.mutedBody}>
                  No tip sheets for today — employees may not have declared
                  yet.
                </Text>
              )}
              {sheets.map((sheet) => (
                <View key={sheet.id} style={styles.sheetBlock}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.dataName}>
                      {sheet.outlet_name ?? "Outlet"} ·{" "}
                      {sheet.status === "pending"
                        ? "needs totals"
                        : (sheet.status ?? "")}
                    </Text>
                    <Pressable onPress={() => openAddMember(sheet.id)}>
                      <Text style={styles.linkText}>+ Add team member</Text>
                    </Pressable>
                  </View>
                  {rows
                    .filter((r) => r.sheet_id === sheet.id)
                    .map((r) => (
                      <View key={r.row_id} style={styles.dataRow}>
                        <Text style={styles.dataName}>{titleCase(r.name)}</Text>
                        <Text style={styles.dataMeta}>
                          SC {fmtUSD(r.declared_sc)} · NC{" "}
                          {fmtUSD(r.declared_nc)}
                          {r.tip_amount !== null
                            ? ` · payout ${fmtUSD(r.tip_amount)}`
                            : ""}
                        </Text>
                        <Pressable
                          onPress={() => {
                            setAdjusting(r);
                            setAdjSc(r.declared_sc.toFixed(2));
                            setAdjNc(r.declared_nc.toFixed(2));
                          }}
                        >
                          <Text style={styles.linkText}>Add adjustment</Text>
                        </Pressable>
                      </View>
                    ))}
                  {adding === sheet.id && (
                    <View style={styles.pickerBox}>
                      <Text style={styles.stepHint}>Add who?</Text>
                      {employees
                        .filter(
                          (e) =>
                            !rows.some(
                              (r) =>
                                r.sheet_id === sheet.id &&
                                r.employee_id === e.id
                            )
                        )
                        .map((e) => (
                          <Pressable
                            key={e.id}
                            disabled={busy}
                            onPress={() => addMember(e.id)}
                          >
                            <Text style={styles.pickerRow}>{titleCase(e.name)}</Text>
                          </Pressable>
                        ))}
                      <Pressable onPress={() => setAdding(null)}>
                        <Text style={styles.mutedBody}>Cancel</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ))}
              {adjusting && (
                <View style={styles.pickerBox}>
                  <Text style={styles.stepHint}>
                    Adjust {adjusting.name}'s declared amounts
                  </Text>
                  <View style={styles.adjRow}>
                    <TextInput
                      style={styles.adjInput}
                      value={adjSc}
                      onChangeText={setAdjSc}
                      keyboardType="decimal-pad"
                      placeholder="SC"
                      placeholderTextColor={colors.muted}
                    />
                    <TextInput
                      style={styles.adjInput}
                      value={adjNc}
                      onChangeText={setAdjNc}
                      keyboardType="decimal-pad"
                      placeholder="NC"
                      placeholderTextColor={colors.muted}
                    />
                    <Pressable
                      style={[styles.primaryButtonSm, busy && styles.dim]}
                      disabled={busy}
                      onPress={saveAdjustment}
                    >
                      <Text style={styles.primaryButtonText}>Save</Text>
                    </Pressable>
                    <Pressable onPress={() => setAdjusting(null)}>
                      <Text style={styles.mutedBody}>Cancel</Text>
                    </Pressable>
                  </View>
                </View>
              )}
              <Pressable
                style={[styles.primaryButton, busy && styles.dim]}
                disabled={busy}
                onPress={approveTips}
              >
                <Text style={styles.primaryButtonText}>
                  {busy ? "Working..." : "Run totals & continue →"}
                </Text>
              </Pressable>
            </View>
          )}

          {step === 2 && (
            <View style={styles.card}>
              <Text style={styles.stepTitle}>Sales check</Text>
              <Text style={styles.stepHint}>
                Do the large parties below match the POS?
              </Text>
              {parties.length === 0 ? (
                <Text style={styles.mutedBody}>
                  No large parties recorded today.
                </Text>
              ) : (
                <>
                  {parties.map((p, i) => (
                    <View
                      key={p.id}
                      style={[styles.dataRow, i > 0 && styles.rowBorder]}
                    >
                      <Text style={styles.dataName}>{fmtUSD(p.revenue)}</Text>
                      {p.notes ? (
                        <Text style={styles.dataMeta}>{p.notes}</Text>
                      ) : null}
                    </View>
                  ))}
                  <Text style={styles.dataMeta}>
                    Party total: {fmtUSD(partyTotal)}
                  </Text>
                </>
              )}
              <Pressable
                style={styles.primaryButton}
                onPress={() => setStep(3)}
              >
                <Text style={styles.primaryButtonText}>Looks right →</Text>
              </Pressable>
            </View>
          )}

          {step === 3 && (
            <View style={styles.card}>
              <Text style={styles.stepTitle}>Notes</Text>
              <TextInput
                style={styles.notesInput}
                value={notes}
                onChangeText={setNotes}
                placeholder="How did the shift go? Anything for tomorrow?"
                placeholderTextColor={colors.muted}
                multiline
              />
              <Pressable
                style={styles.primaryButton}
                onPress={() => setStep(4)}
              >
                <Text style={styles.primaryButtonText}>Continue →</Text>
              </Pressable>
            </View>
          )}

          {step === 4 && (
            <View style={styles.card}>
              <Text style={styles.stepTitle}>Submit</Text>
              <Text style={styles.mutedBody}>
                Submitting posts every computed tip sheet (pay starts reading
                them) and locks today's report. This can't be undone from the
                app.
              </Text>
              <Pressable
                style={[styles.primaryButton, busy && styles.dim]}
                disabled={busy}
                onPress={submit}
              >
                <Text style={styles.primaryButtonText}>
                  {busy ? "Submitting..." : "Submit & lock the day"}
                </Text>
              </Pressable>
            </View>
          )}

          {step > 0 && (
            <Pressable onPress={() => setStep(step - 1)}>
              <Text style={styles.backLink}>← Back a step</Text>
            </Pressable>
          )}
        </>
      )}
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
    gap: 12,
  },
  header: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.foreground,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  stepsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  stepChipWrap: {},
  stepChip: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    overflow: "hidden",
  },
  stepChipActive: {
    color: colors.primaryOn,
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  stepChipDone: {
    color: colors.primaryDim,
    borderColor: colors.primary,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.foreground,
  },
  stepHint: {
    marginTop: 4,
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
    marginBottom: 6,
  },
  dataRow: {
    paddingVertical: 7,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dataName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  dataMeta: {
    marginTop: 1,
    fontSize: 12,
    color: colors.muted,
  },
  sheetBlock: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  linkText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.primaryDim,
  },
  pickerBox: {
    marginTop: 8,
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    gap: 6,
  },
  pickerRow: {
    fontSize: 14,
    color: colors.foreground,
    paddingVertical: 5,
  },
  adjRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  adjInput: {
    width: 90,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.card,
    color: colors.foreground,
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  notesInput: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: 14,
    padding: 12,
    minHeight: 110,
    textAlignVertical: "top",
  },
  primaryButton: {
    marginTop: 14,
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  primaryButtonSm: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: colors.primaryOn,
    fontSize: 14,
    fontWeight: "600",
  },
  dim: {
    opacity: 0.5,
  },
  doneTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.primaryDim,
  },
  backLink: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
    paddingHorizontal: 4,
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
    lineHeight: 18,
    paddingHorizontal: 4,
  },
  mutedBody: {
    marginTop: 4,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
  },
  mutedCenter: {
    textAlign: "center",
    color: colors.muted,
    marginTop: 24,
  },
});

import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { format } from "date-fns";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { showToast } from "../components/Toast";
import {
  type InboxCoverage,
  type InboxPto,
  type InboxSwap,
  type InboxTimecard,
  type InboxTipSheet,
  type ManagerInbox,
  approveCoverage,
  approvePto,
  approveSwap,
  approveTimecard,
  computeTipSheet,
  denyCoverage,
  denyPto,
  denySwap,
  getInbox,
  getUpcomingShifts,
  postTipSheet,
} from "../lib/manager";
import { colors } from "../lib/theme";
import LargePartyEntryModal from "./LargePartyEntryModal";

// The manager's approval inbox: one RPC round-trip (manager_approval_inbox,
// 012) rendered as five sections — PTO, tip sheets, coverage, swaps, and
// timecards awaiting approval. Every action re-verifies manager status
// server-side; rows are removed optimistically then the inbox reloads.
// Confirmation is the uniform two-tap pattern (tap Approve → tap Confirm),
// since Alert.alert is a no-op on react-native-web.

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; inbox: ManagerInbox; refreshedAt: Date };

type PendingAction = { rowKey: string; action: string } | null;

function fmtDay(d: string | null): string {
  return d ? format(new Date(`${d.slice(0, 10)}T00:00:00`), "EEE, MMM d") : "—";
}

/** "HH:MM:SS" → "10:00", null-safe. */
function fmtTime(t: string | null): string {
  return t ? t.slice(0, 5) : "—";
}

function fmtClock(iso: string | null): string {
  return iso ? format(new Date(iso), "h:mm a") : "—";
}

function fmtUSD(n: number): string {
  return (
    "$" +
    Number(n).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export default function ManagerInboxScreen() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [partyOpen, setPartyOpen] = useState(false);
  // "any shift" swap approval: the picked shift per swap id
  const [targetShifts, setTargetShifts] = useState<
    Awaited<ReturnType<typeof getUpcomingShifts>> | null
  >(null);
  const [pickedShift, setPickedShift] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    const seq = ++requestSeq.current;
    if (mode === "initial") setState({ kind: "loading" });
    else setRefreshing(true);
    try {
      const inbox = await getInbox();
      if (seq === requestSeq.current) {
        setState({ kind: "ready", inbox, refreshedAt: new Date() });
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
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(state.kind === "ready" ? "refresh" : "initial");
      // reload-on-focus only
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load])
  );

  function toggleExpand(rowKey: string, swap?: InboxSwap) {
    setPending(null);
    setActionError(null);
    setPickedShift(null);
    setTargetShifts(null);
    setExpanded((cur) => (cur === rowKey ? null : rowKey));
    if (swap?.needs_target_shift) {
      getUpcomingShifts(swap.new_employee_id)
        .then(setTargetShifts)
        .catch(() => setTargetShifts([]));
    }
  }

  /** Optimistically drop a row, then reload in the background. */
  function removeRow(section: keyof ManagerInbox["counts"], id: string) {
    setExpanded(null);
    setPending(null);
    setState((cur) => {
      if (cur.kind !== "ready") return cur;
      const inbox = { ...cur.inbox };
      const listKey = (
        {
          ptos: "pending_ptos",
          tip_sheets: "pending_tip_sheets",
          coverage: "pending_coverage",
          swaps: "pending_swaps",
          timecards: "pending_timecards",
        } as const
      )[section];
      inbox[listKey] = (inbox[listKey] as { id: string }[]).filter(
        (r) => r.id !== id
      ) as never;
      inbox.counts = {
        ...inbox.counts,
        [section]: Math.max(0, inbox.counts[section] - 1),
      };
      inbox.total_pending = Math.max(0, inbox.total_pending - 1);
      return { ...cur, inbox };
    });
    load("refresh");
  }

  async function run(
    rowKey: string,
    action: string,
    fn: () => Promise<void>,
    onDone: () => void,
    toast: string
  ) {
    if (pending?.rowKey !== rowKey || pending.action !== action) {
      setPending({ rowKey, action });
      setActionError(null);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      showToast(toast);
      onDone();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Something went wrong");
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const confirmLabel = (rowKey: string, action: string, label: string) =>
    pending?.rowKey === rowKey && pending.action === action
      ? `Confirm ${label.toLowerCase()}`
      : label;

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
        {state.kind === "loading" && (
          <View style={[styles.card, styles.centered]}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}

        {state.kind === "error" && (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>Couldn't load the inbox</Text>
            <Text style={styles.mutedBody}>{state.message}</Text>
            <Pressable style={styles.primaryButton} onPress={() => load("initial")}>
              <Text style={styles.primaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {state.kind === "ready" && (
          <>
            <View style={styles.headerCard}>
              <Text style={styles.headerCount}>
                {state.inbox.total_pending} pending
              </Text>
              <Text style={styles.headerMeta}>
                refreshed {format(state.refreshedAt, "h:mm a")}
              </Text>
            </View>

            {state.inbox.total_pending === 0 && (
              <View style={styles.card}>
                <Text style={styles.emptyTitle}>
                  Nothing to approve right now — nice work
                </Text>
              </View>
            )}

            {state.inbox.pending_ptos.length > 0 && (
              <Section title={`PTO requests (${state.inbox.counts.ptos})`}>
                {state.inbox.pending_ptos.map((p) => (
                  <Row
                    key={p.id}
                    rowKey={`pto:${p.id}`}
                    expanded={expanded}
                    onToggle={() => toggleExpand(`pto:${p.id}`)}
                    title={p.employee_name}
                    subtitle={`${fmtDay(p.start_date)} – ${fmtDay(p.end_date)} · ${p.reason ?? "—"}${p.total_hours_requested ? ` · ${p.total_hours_requested}h` : ""}`}
                  >
                    <ActionRow
                      error={actionError}
                      busy={busy}
                      buttons={[
                        {
                          label: confirmLabel(`pto:${p.id}`, "approve", "Approve"),
                          primary: true,
                          onPress: () =>
                            run(
                              `pto:${p.id}`,
                              "approve",
                              () => approvePto(p),
                              () => removeRow("ptos", p.id),
                              "PTO approved."
                            ),
                        },
                        {
                          label: confirmLabel(`pto:${p.id}`, "deny", "Deny"),
                          onPress: () =>
                            run(
                              `pto:${p.id}`,
                              "deny",
                              () => denyPto(p.id),
                              () => removeRow("ptos", p.id),
                              "PTO denied."
                            ),
                        },
                      ]}
                    />
                  </Row>
                ))}
              </Section>
            )}

            {state.inbox.pending_tip_sheets.length > 0 && (
              <Section
                title={`Tip sheets awaiting review (${state.inbox.counts.tip_sheets})`}
              >
                {state.inbox.pending_tip_sheets.map((s) => (
                  <Row
                    key={s.id}
                    rowKey={`sheet:${s.id}`}
                    expanded={expanded}
                    onToggle={() => toggleExpand(`sheet:${s.id}`)}
                    title={`${s.outlet_name ?? "—"} · ${fmtDay(s.date)}`}
                    subtitle={`${s.status === "pending" ? "Needs compute" : "Ready to post"} · ${s.row_count} ${s.row_count === 1 ? "declaration" : "declarations"} · declared ${fmtUSD(s.declared_total)}${s.large_party_total > 0 ? ` · parties ${fmtUSD(s.large_party_total)}` : ""}`}
                  >
                    <ActionRow
                      error={actionError}
                      busy={busy}
                      note={
                        s.status === "pending"
                          ? "Computing runs the tip formula and locks employee edits."
                          : "Posting locks the sheet; the pay engine starts reading it."
                      }
                      buttons={[
                        s.status === "pending"
                          ? {
                              label: confirmLabel(
                                `sheet:${s.id}`,
                                "compute",
                                "Compute & mark ready"
                              ),
                              primary: true,
                              onPress: () =>
                                run(
                                  `sheet:${s.id}`,
                                  "compute",
                                  () => computeTipSheet(s.id),
                                  () => load("refresh"),
                                  "Tip sheet computed — now ready to post."
                                ),
                            }
                          : {
                              label: confirmLabel(`sheet:${s.id}`, "post", "Post sheet"),
                              primary: true,
                              onPress: () =>
                                run(
                                  `sheet:${s.id}`,
                                  "post",
                                  () => postTipSheet(s.id),
                                  () => removeRow("tip_sheets", s.id),
                                  "Tip sheet posted."
                                ),
                            },
                      ]}
                    />
                  </Row>
                ))}
              </Section>
            )}

            {state.inbox.pending_coverage.length > 0 && (
              <Section
                title={`Coverage requests (${state.inbox.counts.coverage})`}
              >
                {state.inbox.pending_coverage.map((c) => (
                  <Row
                    key={c.id}
                    rowKey={`cov:${c.id}`}
                    expanded={expanded}
                    onToggle={() => toggleExpand(`cov:${c.id}`)}
                    title={`${fmtDay(c.shift_date)} · ${fmtTime(c.start_time)}–${fmtTime(c.end_time)}${c.position ? ` · ${c.position}` : ""}`}
                    subtitle={`${c.caller_out_name} called out · ${c.volunteer_name ?? "?"} volunteered${c.outlet_name ? ` · ${c.outlet_name}` : ""}`}
                  >
                    <ActionRow
                      error={actionError}
                      busy={busy}
                      note="Approving reassigns the shift to the volunteer. Denying rejects this volunteer and re-opens the request for other teammates."
                      buttons={[
                        {
                          label: confirmLabel(`cov:${c.id}`, "approve", "Approve"),
                          primary: true,
                          onPress: () =>
                            run(
                              `cov:${c.id}`,
                              "approve",
                              () => approveCoverage(c.id),
                              () => removeRow("coverage", c.id),
                              "Coverage approved — shift reassigned."
                            ),
                        },
                        {
                          label: confirmLabel(`cov:${c.id}`, "deny", "Deny volunteer"),
                          onPress: () =>
                            run(
                              `cov:${c.id}`,
                              "deny",
                              () => denyCoverage(c.id),
                              () => removeRow("coverage", c.id),
                              "Volunteer declined — request re-opened."
                            ),
                        },
                      ]}
                    />
                  </Row>
                ))}
              </Section>
            )}

            {state.inbox.pending_swaps.length > 0 && (
              <Section title={`Swap requests (${state.inbox.counts.swaps})`}>
                {state.inbox.pending_swaps.map((w) => (
                  <Row
                    key={w.id}
                    rowKey={`swap:${w.id}`}
                    expanded={expanded}
                    onToggle={() => toggleExpand(`swap:${w.id}`, w)}
                    title={`${w.initiator_name} ⇄ ${w.target_name}`}
                    subtitle={`Gives ${fmtDay(w.requested_shift_date)} ${fmtTime(w.requested_start_time)}–${fmtTime(w.requested_end_time)} · takes ${w.needs_target_shift ? "any of their shifts" : `${fmtDay(w.offered_shift_date)} ${fmtTime(w.offered_start_time)}–${fmtTime(w.offered_end_time)}`}`}
                  >
                    <>
                      {w.needs_target_shift && (
                        <View style={styles.pickerBlock}>
                          <Text style={styles.pickerLabel}>
                            Pick which of {w.target_name}'s shifts goes to{" "}
                            {w.initiator_name}:
                          </Text>
                          {targetShifts === null ? (
                            <ActivityIndicator color={colors.primary} />
                          ) : targetShifts.length === 0 ? (
                            <Text style={styles.mutedBody}>
                              No upcoming shifts to trade — deny this one.
                            </Text>
                          ) : (
                            targetShifts.map((sh) => (
                              <Pressable
                                key={sh.id}
                                style={styles.pickRow}
                                onPress={() => setPickedShift(sh.id)}
                              >
                                <Ionicons
                                  name={
                                    pickedShift === sh.id
                                      ? "radio-button-on"
                                      : "radio-button-off"
                                  }
                                  size={16}
                                  color={
                                    pickedShift === sh.id
                                      ? colors.primary
                                      : colors.muted
                                  }
                                />
                                <Text style={styles.pickRowText}>
                                  {fmtDay(sh.date)} · {fmtTime(sh.start_time)}–
                                  {fmtTime(sh.end_time)}
                                  {sh.position ? ` · ${sh.position}` : ""}
                                </Text>
                              </Pressable>
                            ))
                          )}
                        </View>
                      )}
                      <ActionRow
                        error={actionError}
                        busy={busy}
                        buttons={[
                          {
                            label: confirmLabel(`swap:${w.id}`, "approve", "Approve"),
                            primary: true,
                            disabled: w.needs_target_shift && !pickedShift,
                            onPress: () =>
                              run(
                                `swap:${w.id}`,
                                "approve",
                                () =>
                                  approveSwap(
                                    w.id,
                                    w.needs_target_shift
                                      ? (pickedShift ?? undefined)
                                      : undefined
                                  ),
                                () => removeRow("swaps", w.id),
                                "Swap approved — both shifts reassigned."
                              ),
                          },
                          {
                            label: confirmLabel(`swap:${w.id}`, "deny", "Deny"),
                            onPress: () =>
                              run(
                                `swap:${w.id}`,
                                "deny",
                                () => denySwap(w.id),
                                () => removeRow("swaps", w.id),
                                "Swap denied."
                              ),
                          },
                        ]}
                      />
                    </>
                  </Row>
                ))}
              </Section>
            )}

            {state.inbox.pending_timecards.length > 0 && (
              <Section
                title={`Timecards awaiting approval (${state.inbox.counts.timecards})`}
              >
                {state.inbox.pending_timecards.map((t) => (
                  <Row
                    key={t.id}
                    rowKey={`tc:${t.id}`}
                    expanded={expanded}
                    onToggle={() => toggleExpand(`tc:${t.id}`)}
                    title={`${t.employee_name} · ${fmtDay(t.date)}`}
                    subtitle={
                      t.missing_punch
                        ? `⚠ Missing punch · in ${fmtClock(t.clock_in)} · out ${fmtClock(t.clock_out)}`
                        : `in ${fmtClock(t.clock_in)} · out ${fmtClock(t.clock_out)} · ${t.break_minutes}m break`
                    }
                  >
                    {t.missing_punch ? (
                      <Text style={styles.mutedBody}>
                        This timecard is missing a punch — fix it on the web
                        Timecards page (approval requires both clock in and
                        clock out).
                      </Text>
                    ) : (
                      <ActionRow
                        error={actionError}
                        busy={busy}
                        buttons={[
                          {
                            label: confirmLabel(`tc:${t.id}`, "approve", "Approve"),
                            primary: true,
                            onPress: () =>
                              run(
                                `tc:${t.id}`,
                                "approve",
                                () => approveTimecard(t.id),
                                () => removeRow("timecards", t.id),
                                "Timecard approved."
                              ),
                          },
                        ]}
                      />
                    )}
                  </Row>
                ))}
              </Section>
            )}

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Quick actions</Text>
              <Pressable
                style={styles.primaryButton}
                onPress={() => setPartyOpen(true)}
              >
                <Text style={styles.primaryButtonText}>
                  Enter large-party sale
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      <LargePartyEntryModal
        visible={partyOpen}
        onClose={() => setPartyOpen(false)}
        onSaved={() => {
          setPartyOpen(false);
          load("refresh");
        }}
      />
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({
  rowKey,
  expanded,
  onToggle,
  title,
  subtitle,
  children,
}: {
  rowKey: string;
  expanded: string | null;
  onToggle: () => void;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const open = expanded === rowKey;
  return (
    <View style={styles.row}>
      <Pressable style={styles.rowHeader} onPress={onToggle}>
        <View style={styles.rowInfo}>
          <Text style={styles.rowTitle}>{title}</Text>
          <Text style={styles.rowSubtitle}>{subtitle}</Text>
        </View>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.muted}
        />
      </Pressable>
      {open && <View style={styles.rowBody}>{children}</View>}
    </View>
  );
}

function ActionRow({
  buttons,
  busy,
  error,
  note,
}: {
  buttons: {
    label: string;
    onPress: () => void;
    primary?: boolean;
    disabled?: boolean;
  }[];
  busy: boolean;
  error: string | null;
  note?: string;
}) {
  return (
    <View>
      {note ? <Text style={styles.actionNote}>{note}</Text> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.actionButtons}>
        {buttons.map((b) => (
          <Pressable
            key={b.label}
            style={[
              b.primary ? styles.primaryButton : styles.secondaryButton,
              (busy || b.disabled) && styles.dim,
            ]}
            disabled={busy || b.disabled}
            onPress={b.onPress}
          >
            <Text
              style={
                b.primary ? styles.primaryButtonText : styles.secondaryButtonText
              }
            >
              {busy ? "Working..." : b.label}
            </Text>
          </Pressable>
        ))}
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
  centered: {
    alignItems: "center",
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  headerCard: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  headerCount: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.foreground,
  },
  headerMeta: {
    fontSize: 12,
    color: colors.muted,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: 4,
  },
  row: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 8,
    paddingTop: 8,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowInfo: {
    flexShrink: 1,
    paddingRight: 8,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  rowSubtitle: {
    marginTop: 1,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },
  rowBody: {
    marginTop: 10,
  },
  actionNote: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
    marginBottom: 8,
  },
  actionButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 16,
    alignItems: "center",
    marginTop: 4,
  },
  primaryButtonText: {
    color: colors.primaryOn,
    fontSize: 13,
    fontWeight: "600",
  },
  secondaryButton: {
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    marginTop: 4,
  },
  secondaryButtonText: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: "600",
  },
  dim: {
    opacity: 0.5,
  },
  pickerBlock: {
    marginBottom: 8,
  },
  pickerLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: 6,
  },
  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  pickRowText: {
    fontSize: 13,
    color: colors.foreground,
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
  errorText: {
    fontSize: 13,
    color: "#dc2626",
    lineHeight: 18,
    marginBottom: 8,
  },
});

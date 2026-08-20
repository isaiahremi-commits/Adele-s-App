import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { format } from "date-fns";
import { titleCase } from "../lib/format";
import {
  type ScheduleShift,
  type TeammateShift,
  formatShiftTime,
} from "../lib/schedule";
import type { TipStatus } from "../lib/tips";
import type { MyCalloutOrOffer } from "../lib/coverage";
import type { MySwapRequest } from "../lib/swaps";
import {
  type MyBreakState,
  getMyBreakState,
  punchBreak,
} from "../lib/pay";
import { colors } from "../lib/theme";

// Shift detail sheet (PR #18) — opened from the Schedule grid and the Home
// "today" card. Carries everything the old ScheduleScreen shift cards held:
// outlet/position/time/type/notes, the "Working with you" teammate list
// (first names + positions, from my_teammate_shifts), and the per-shift
// actions (declare tips / call out / request swap) so none of the PR #7–#9
// flows regressed in the redesign.

function fmtUSD(n: number): string {
  return (
    "$" +
    n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export default function ShiftDetailModal({
  shift,
  teammates,
  tipStatus,
  notTipped,
  myCallout,
  pendingSwap,
  missedPunchPending,
  onDeclareTips,
  onCallOut,
  onRequestSwap,
  onMissedPunch,
  onClose,
}: {
  shift: ScheduleShift | null; // null = hidden
  /** Teammate shifts for the SAME day+outlet (parent filters). */
  teammates: TeammateShift[];
  tipStatus?: TipStatus;
  notTipped?: boolean;
  myCallout?: MyCalloutOrOffer;
  pendingSwap?: MySwapRequest;
  /** PR #20: a pending missed-punch request exists for this shift. */
  missedPunchPending?: boolean;
  onDeclareTips?: () => void;
  onCallOut?: () => void;
  onRequestSwap?: () => void;
  /** PR #20: open the missed-punch request flow (past shifts). */
  onMissedPunch?: () => void;
  onClose: () => void;
}) {
  if (!shift) return null;
  const dateLabel = shift.date
    ? format(new Date(`${shift.date}T00:00:00`), "EEEE, MMM d")
    : "—";

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <ScrollView contentContainerStyle={styles.sheetContent}>
            <View style={styles.headerRow}>
              <Text style={styles.dateLabel}>{dateLabel}</Text>
              {shift.shift_type ? (
                <View style={styles.typePill}>
                  <Text style={styles.typePillText}>{shift.shift_type}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.positionLine}>
              {[titleCase(shift.position) || "Shift", shift.outlets?.name]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            <Text style={styles.timeLine}>
              {formatShiftTime(shift.start_time)} –{" "}
              {formatShiftTime(shift.end_time)}
            </Text>
            {shift.notes ? (
              <Text style={styles.notes}>{shift.notes}</Text>
            ) : null}

            <Text style={styles.sectionLabel}>Working with you</Text>
            {teammates.length === 0 ? (
              <Text style={styles.mutedBody}>
                No teammates on the schedule with you.
              </Text>
            ) : (
              teammates.map((t) => (
                <View key={t.id} style={styles.teammateRow}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {t.employees?.first_name?.[0]?.toUpperCase() ?? "?"}
                    </Text>
                  </View>
                  <Text style={styles.teammateName}>
                    {t.employees?.first_name ?? "Teammate"}
                  </Text>
                  <Text style={styles.teammateMeta}>
                    {[
                      titleCase(t.position),
                      `${formatShiftTime(t.start_time)}–${formatShiftTime(t.end_time)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
              ))
            )}

            {/* PR #27 item 7: break punches for today's shift. */}
            <BreakSection shift={shift} />

            {/* per-shift actions, verbatim behavior from the old cards */}
            {(notTipped || tipStatus || myCallout || onCallOut || pendingSwap || onRequestSwap || onMissedPunch || missedPunchPending) && (
              <View style={styles.actionsBlock}>
                {notTipped ? (
                  <Text style={styles.tipDim}>
                    Tips not applicable to this position.
                  </Text>
                ) : tipStatus ? (
                  <TipActionRow status={tipStatus} onPress={onDeclareTips} />
                ) : null}
                {missedPunchPending ? (
                  <Text style={styles.tipDim}>
                    Missed punch request pending
                  </Text>
                ) : onMissedPunch ? (
                  <Pressable onPress={onMissedPunch}>
                    <Text style={styles.swapLink}>Report a missed punch →</Text>
                  </Pressable>
                ) : null}
                {myCallout ? (
                  <Text style={styles.calledOutNote}>
                    Called out
                    {myCallout.coverage_status === "volunteer_pending" &&
                    myCallout.volunteer_name
                      ? ` — ${myCallout.volunteer_name} offered to cover`
                      : myCallout.coverage_status === "approved"
                        ? " — covered"
                        : " — awaiting coverage"}
                  </Text>
                ) : (
                  <View style={styles.actionRow}>
                    {onCallOut && (
                      <Pressable onPress={onCallOut}>
                        <Text style={styles.callOutLink}>Call out</Text>
                      </Pressable>
                    )}
                    {pendingSwap ? (
                      <Text style={styles.swapPendingNote}>
                        Swap requested —{" "}
                        {pendingSwap.status === "pending_target"
                          ? `waiting on ${pendingSwap.counterparty_name}`
                          : "waiting on manager"}
                      </Text>
                    ) : onRequestSwap ? (
                      <Pressable onPress={onRequestSwap}>
                        <Text style={styles.swapLink}>Request swap →</Text>
                      </Pressable>
                    ) : null}
                  </View>
                )}
              </View>
            )}

            <Pressable style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeButtonText}>Close</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TipActionRow({
  status,
  onPress,
}: {
  status: TipStatus;
  onPress?: () => void;
}) {
  if (!status.sheetExists) {
    return <Text style={styles.tipDim}>Tip sheet not yet open</Text>;
  }
  if (status.sheetStatus === "posted") {
    return (
      <Text style={styles.tipFinal}>
        Tips finalized
        {status.tipAmount !== null ? `: ${fmtUSD(status.tipAmount)}` : ""}
      </Text>
    );
  }
  if (!status.sheetOpen) {
    return (
      <Text style={styles.tipDim}>
        {status.rowId
          ? "Tips declared ✓ — pending manager review"
          : "Tip sheet closed for review"}
      </Text>
    );
  }
  if (!status.rowId) {
    return (
      <Pressable style={styles.tipDeclareButton} onPress={onPress}>
        <Text style={styles.tipDeclareButtonText}>Declare tips →</Text>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress}>
      <Text style={styles.tipDeclaredLink}>Tips declared ✓ · Edit</Text>
    </Pressable>
  );
}

// PR #27 item 7: Start/End break for TODAY's shift. Mobile has no clock-in
// flow yet, so the punch RPC find-or-creates the caller's own pending
// timecard server-side; managers see the punches on the web Break popover.
function BreakSection({ shift }: { shift: ScheduleShift }) {
  const today = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const todayIso = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
  const isToday = shift.date === todayIso;
  const [state, setState] = useState<MyBreakState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isToday) {
      getMyBreakState(shift.id).then(setState).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift.id, isToday]);

  if (!isToday) return null;

  const onBreak = !!(
    (state?.break1_in && !state?.break1_out) ||
    (state?.break2_in && !state?.break2_out)
  );
  const done = !!(state?.break1_out && state?.break2_out);
  const label = onBreak
    ? "End break"
    : state?.break1_out
      ? "Start break 2"
      : "Start break";

  async function punch() {
    setBusy(true);
    setError(null);
    try {
      setState(await punchBreak(shift.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't record the punch");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.breakBlock}>
      {done ? (
        <Text style={styles.breakDone}>
          Breaks recorded — {state?.break_minutes ?? 0} min total
        </Text>
      ) : (
        <Pressable
          style={[styles.breakButton, onBreak && styles.breakButtonActive]}
          disabled={busy}
          onPress={punch}
        >
          <Text style={[styles.breakButtonText, onBreak && styles.breakButtonTextActive]}>
            {busy ? "Saving…" : label}
          </Text>
        </Pressable>
      )}
      {onBreak && !done && (
        <Text style={styles.breakNote}>Break in progress…</Text>
      )}
      {error && <Text style={styles.breakError}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  breakBlock: {
    marginTop: 10,
    gap: 4,
  },
  breakButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
  },
  breakButtonActive: {
    backgroundColor: colors.primary,
  },
  breakButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.primary,
  },
  breakButtonTextActive: {
    color: colors.primaryOn,
  },
  breakNote: {
    fontSize: 12,
    color: colors.mutedStrong,
  },
  breakDone: {
    fontSize: 13,
    color: colors.mutedStrong,
  },
  breakError: {
    fontSize: 12,
    color: colors.danger,
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: "center",
    padding: 20,
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: 14,
    maxHeight: "85%",
  },
  sheetContent: {
    padding: 18,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dateLabel: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.foreground,
  },
  typePill: {
    backgroundColor: colors.infoSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  typePillText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.infoText,
  },
  positionLine: {
    marginTop: 4,
    fontSize: 15,
    fontWeight: "600",
    color: colors.foreground,
  },
  timeLine: {
    marginTop: 2,
    fontSize: 14,
    color: colors.muted,
  },
  notes: {
    marginTop: 8,
    fontSize: 13,
    color: colors.muted,
    fontStyle: "italic",
    lineHeight: 18,
  },
  sectionLabel: {
    marginTop: 16,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: "700",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  mutedBody: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
  },
  teammateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 5,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.primaryDim,
  },
  teammateName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  teammateMeta: {
    flex: 1,
    fontSize: 12,
    color: colors.muted,
    textAlign: "right",
  },
  actionsBlock: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 16,
    marginTop: 8,
  },
  tipDim: {
    fontSize: 13,
    color: colors.muted,
  },
  tipFinal: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
  },
  tipDeclareButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  tipDeclareButtonText: {
    color: colors.primaryOn,
    fontSize: 13,
    fontWeight: "600",
  },
  tipDeclaredLink: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primaryDim,
  },
  callOutLink: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.amber,
  },
  swapLink: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primaryDim,
  },
  swapPendingNote: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
  },
  calledOutNote: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: "600",
    color: colors.amber,
  },
  closeButton: {
    marginTop: 18,
    alignSelf: "flex-end",
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  closeButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.muted,
  },
});

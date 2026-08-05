import { supabase } from "./supabase";

// Employee tip-declaration data layer, backed by migration 009:
//   tip_declaration_for_me — one shift day's sheet/declaration status;
//   tip_declaration_submit — upsert own declaration on a PENDING sheet
//     (server verifies an approved timecard at that outlet that day);
//   tip_history_for_me — own declarations in a date range.
// Everything infers the employee from auth.uid() server-side; tenant scoping
// is RLS's job — no client-side tenant filters (same conventions as pay.ts).

export type TipStatus = {
  sheetExists: boolean;
  sheetOpen: boolean;
  sheetStatus: string | null;
  rowId: string | null;
  declaredServiceCharge: number | null;
  declaredNonCash: number | null;
  declaredLargeParty: number | null;
  /** Finalized payout — non-null only once the sheet is posted. */
  tipAmount: number | null;
};

export type TipHistoryEntry = {
  shift_date: string;
  outlet_id: string | null;
  outlet_name: string | null;
  sheet_status: string | null;
  declared_service_charge: number | null;
  declared_non_cash: number | null;
  declared_large_party: number | null;
  tip_amount: number | null;
};

/** numeric columns can arrive as string over PostgREST — normalize, keep null. */
function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** Key for the per-shift tip status map: one status per (outlet, day). */
export function shiftTipKey(outletId: string, date: string): string {
  return `${outletId}|${date}`;
}

/** One shift day's declaration status for the signed-in employee. */
export async function getTipStatus(
  outletId: string,
  shiftDate: string
): Promise<TipStatus> {
  const { data, error } = await supabase.rpc("tip_declaration_for_me", {
    p_outlet_id: outletId,
    p_shift_date: shiftDate,
  });
  if (error) {
    throw new Error(error.message);
  }
  const row = data?.[0];
  if (!row) {
    // The RPC always returns one row; treat a missing one as "no sheet".
    return {
      sheetExists: false,
      sheetOpen: false,
      sheetStatus: null,
      rowId: null,
      declaredServiceCharge: null,
      declaredNonCash: null,
      declaredLargeParty: null,
      tipAmount: null,
    };
  }
  return {
    sheetExists: row.sheet_exists,
    sheetOpen: row.sheet_open,
    sheetStatus: row.sheet_status ?? null,
    rowId: row.row_id ?? null,
    declaredServiceCharge: num(row.declared_service_charge),
    declaredNonCash: num(row.declared_non_cash),
    declaredLargeParty: num(row.declared_large_party),
    tipAmount: num(row.tip_amount),
  };
}

/**
 * Batched status lookup for the Schedule tab: one RPC per UNIQUE
 * (outlet, day) pair — several same-day shifts at one outlet share a call.
 */
export async function getTipStatusForShifts(
  pairs: { outletId: string; date: string }[]
): Promise<Map<string, TipStatus>> {
  const unique = new Map<string, { outletId: string; date: string }>();
  for (const p of pairs) {
    unique.set(shiftTipKey(p.outletId, p.date), p);
  }
  const entries = [...unique.entries()];
  const statuses = await Promise.all(
    entries.map(([, p]) => getTipStatus(p.outletId, p.date))
  );
  return new Map(entries.map(([key], i) => [key, statuses[i]]));
}

/**
 * Create or update the caller's declaration for (outlet, day). Amounts in
 * dollars, non-negative; a zero large-party amount removes a previously
 * declared party. Returns the tip_sheet_row id.
 */
export async function submitTipDeclaration(
  outletId: string,
  shiftDate: string,
  serviceCharges: number,
  nonCash: number,
  largeParty: number = 0
): Promise<string> {
  const { data, error } = await supabase.rpc("tip_declaration_submit", {
    p_outlet_id: outletId,
    p_shift_date: shiftDate,
    p_service_charges: serviceCharges,
    p_non_cash: nonCash,
    p_large_party_revenue: largeParty,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** Own declarations inside [from, to] ("yyyy-MM-dd"), newest first. */
export async function getMyTipHistory(
  from: string,
  to: string
): Promise<TipHistoryEntry[]> {
  const { data, error } = await supabase.rpc("tip_history_for_me", {
    p_from: from,
    p_to: to,
  });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => ({
    shift_date: row.shift_date,
    outlet_id: row.outlet_id ?? null,
    outlet_name: row.outlet_name ?? null,
    sheet_status: row.sheet_status ?? null,
    declared_service_charge: num(row.declared_service_charge),
    declared_non_cash: num(row.declared_non_cash),
    declared_large_party: num(row.declared_large_party),
    tip_amount: num(row.tip_amount),
  }));
}

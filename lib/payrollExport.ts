// Client-side payroll CSV builders (RFC 4180). Pure functions — no React, no
// deps — so they can be unit-tested. The page passes pay_breakdown rows straight
// through; nothing is recalculated here.

export type ExportRow = {
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
  department: string | null;
  job_position: string | null;
  outlet_name: string | null;
  regular_hours: string | number;
  ot_hours: string | number;
  training_hours: string | number;
  pto_hours: string | number;
  regular_pay: string | number | null;
  ot_pay: string | number | null;
  training_pay: string | number | null;
  pto_pay: string | number | null;
  tip_pay: string | number | null;
  manager_amount: string | number | null;
  gross_pay: string | number | null;
};

// RFC 4180: quote fields containing comma, double-quote, CR or LF; double internal quotes.
export function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
export function toCSV(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}
// Pay components: NULL -> empty cell (never "0.00"); real values -> 2dp.
export function amt(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  return Number(v).toFixed(2);
}
// Hours are always present -> 2dp.
export function hours2(v: string | number): string {
  return Number(v ?? 0).toFixed(2);
}

// Sort: outlet asc, department asc, last_name asc.
export function sortForExport<T extends ExportRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    (a.outlet_name || "").localeCompare(b.outlet_name || "") ||
    (a.department || "").localeCompare(b.department || "") ||
    (a.last_name || "").localeCompare(b.last_name || ""));
}

type Ctx = { periodStart: string; periodEnd: string; empNumbers: Record<string, string>; payFrequency?: string };

export const EARNINGS_HEADERS = ["employee_number", "last_name", "first_name", "department", "position", "outlet",
  "pay_period_start", "pay_period_end", "regular_hours", "regular_pay", "ot_hours", "ot_pay",
  "training_hours", "training_pay", "pto_hours", "pto_pay", "tip_pay", "manager_commission_pay", "gross_pay"];

export const HOURS_HEADERS = ["employee_number", "last_name", "first_name", "pay_period_start", "pay_period_end",
  "pay_frequency", "regular_hours", "ot_hours", "pto_hours", "training_hours"];

export function buildEarningsCSV(rows: ExportRow[], ctx: Ctx): string {
  const csvRows = sortForExport(rows).map((r) => [
    ctx.empNumbers[r.employee_id] ?? "", r.last_name ?? "", r.first_name ?? "",
    r.department ?? "", r.job_position ?? "", r.outlet_name ?? "",
    ctx.periodStart, ctx.periodEnd,
    hours2(r.regular_hours), amt(r.regular_pay),
    hours2(r.ot_hours), amt(r.ot_pay),
    hours2(r.training_hours), amt(r.training_pay),
    hours2(r.pto_hours), amt(r.pto_pay),
    amt(r.tip_pay), amt(r.manager_amount), amt(r.gross_pay),
  ]);
  return toCSV(EARNINGS_HEADERS, csvRows);
}

export function buildHoursCSV(rows: ExportRow[], ctx: Ctx): string {
  const csvRows = sortForExport(rows).map((r) => [
    ctx.empNumbers[r.employee_id] ?? "", r.last_name ?? "", r.first_name ?? "",
    ctx.periodStart, ctx.periodEnd, ctx.payFrequency ?? "biweekly",
    hours2(r.regular_hours), hours2(r.ot_hours), hours2(r.pto_hours), hours2(r.training_hours),
  ]);
  return toCSV(HOURS_HEADERS, csvRows);
}

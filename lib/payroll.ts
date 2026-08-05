// Pay-period math moved to shared/payroll.ts (PR #6) so the Expo app — which
// can only import repo code from shared/ at runtime — uses the exact same
// PERIOD_ANCHOR and boundary functions as the web pay engine. Re-exported
// here so existing "@/lib/payroll" imports keep working unchanged.
export * from "../shared/payroll";

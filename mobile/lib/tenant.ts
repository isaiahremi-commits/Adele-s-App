// Tenant scoping is enforced server-side: every RLS policy (migration 005)
// requires tenant_id = current_tenant_id(), and tenant_id columns default to
// the caller's tenant on INSERT — so ordinary queries need no tenant filter.
//
// assertTenantId exists for the exceptional case where a query DOES filter by
// tenant manually (e.g. a future cross-outlet report builder). Call it first
// so a missing claim fails loudly instead of silently returning zero rows.
export function assertTenantId(
  tenantId: string | null | undefined
): asserts tenantId is string {
  if (!tenantId) {
    throw new Error(
      "No tenant assigned: user_metadata.tenant_id is missing from the " +
        "session. RLS would return no rows — refusing to run a " +
        "tenant-filtered query."
    );
  }
}

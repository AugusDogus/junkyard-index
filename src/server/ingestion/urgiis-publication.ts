import { URGIIS_TENANTS } from "./urgiis-configuration";
import { UrgiisCursor } from "./urgiis-cursor";
import { UrgiisTenant } from "./urgiis-tenant";
import type { YardCheckReport } from "~/lib/yard-check";

/** A terminal blocked tenant is deliberately outside reconciliation, including
 * its floor and previous-run baseline. Its prior rows remain untouched. */
export function urgiisPublication(cursor: UrgiisCursor) {
  const blocked = new Set(
    cursor.completed.filter((c) => "blocked" in c).map((c) => c.code),
  );
  const preservedYards = new Set(
    URGIIS_TENANTS.filter((t) => blocked.has(t.code)).flatMap((t) =>
      UrgiisTenant.yards(t).map((y) => y.code),
    ),
  );
  const minimumByYard = new Map(
    URGIIS_TENANTS.filter((t) => !blocked.has(t.code)).flatMap((t) =>
      UrgiisTenant.yards(t).map(
        (y) =>
          [
            y.code,
            t.attribution.kind === "seller"
              ? (t.attribution.minimumByYard[y.code] ?? t.minimumInventory)
              : t.minimumInventory,
          ] as const,
      ),
    ),
  );
  return {
    preservedYards,
    minimumByYard,
    minimum: [...minimumByYard.values()].reduce((n, v) => n + v, 0),
  };
}

/**
 * Each yard's result in a run's cursor, by its tenant's verdict. An accepted
 * tenant read its owner page, makes, menus and arrivals live this run and
 * reread them at closing; its census carries only model pages whose live
 * badge counts did not change, so its yards are "fetched". An accepted tenant
 * that deferred model pages reused prior listings after failed reads, so its
 * yards are "replayed". A blocked tenant
 * (a provider block or a quarantine stop; the cursor keeps only free text)
 * published nothing, so its yards are "blocked".
 */
export function urgiisYardChecks(
  cursor: Pick<UrgiisCursor, "completed">,
): YardCheckReport[] {
  const verdicts = new Map(cursor.completed.map((c) => [c.code, c] as const));
  return URGIIS_TENANTS.flatMap((tenant) => {
    const verdict = verdicts.get(tenant.code);
    if (verdict === undefined) return [];
    const outcome =
      "blocked" in verdict
        ? "blocked"
        : verdict.deferred !== undefined
          ? "replayed"
          : "fetched";
    return UrgiisTenant.yards(tenant).map((yard) => ({
      locationCode: yard.code,
      outcome,
    }));
  });
}

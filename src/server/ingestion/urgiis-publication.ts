import { URGIIS_TENANTS } from "./urgiis-configuration";
import { UrgiisCursor } from "./urgiis-cursor";
import { UrgiisTenant } from "./urgiis-tenant";

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

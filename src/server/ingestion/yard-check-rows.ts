import { and, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { yardCheck, yardInventory } from "~/schema";
import type { YardCheckRow } from "./yard-check-health";

/** Every listed yard with its check record: one row per yard, no vehicle scan. */
export async function loadYardCheckRows(
  database: LibSQLDatabase,
): Promise<YardCheckRow[]> {
  return database
    .select({
      source: yardInventory.source,
      locationCode: yardInventory.locationCode,
      vehicleCount: yardInventory.vehicleCount,
      outcome: yardCheck.outcome,
      lastCheckedAt: yardCheck.lastCheckedAt,
      lastChangedAt: yardCheck.lastChangedAt,
      consecutiveUncheckedRuns: yardCheck.consecutiveUncheckedRuns,
    })
    .from(yardInventory)
    .leftJoin(
      yardCheck,
      and(
        eq(yardCheck.source, yardInventory.source),
        eq(yardCheck.locationCode, yardInventory.locationCode),
      ),
    )
    .then((rows) =>
      rows.map((row) => ({
        ...row,
        lastCheckedAt: row.lastCheckedAt?.getTime() ?? null,
        lastChangedAt: row.lastChangedAt?.getTime() ?? null,
        consecutiveUncheckedRuns: row.consecutiveUncheckedRuns ?? 0,
      })),
    );
}

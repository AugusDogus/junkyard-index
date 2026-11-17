import { and, eq, ne } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun } from "~/schema";
import { isIngestionSource } from "~/lib/ingestion-source";
import { IngestionDay } from "~/server/ingestion/ingestion-day";
import { IngestionSchedule } from "~/server/ingestion/ingestion-schedule";
import { loadIngestionSourceDays } from "~/server/ingestion/ingestion-source-days";

/** Called while holding the shared commit. Earlier publications release without
 * querying Algolia or advancing saved-search windows. The final run matches the
 * settled index, after native takeovers and same-day removals, before delivery.
 * All scheduled sources are registered together before any workflow starts. */
export async function canMatchSettledIngestionAlerts(
  database: LibSQLDatabase,
  runId: string,
  now = new Date(),
): Promise<boolean> {
  const [run] = await database
    .select({ scheduleKey: ingestionRun.scheduleKey })
    .from(ingestionRun)
    .where(eq(ingestionRun.id, runId))
    .limit(1);
  if (!run)
    throw new Error(
      `Cannot check settled alerts for missing ingestion run ${runId}`,
    );
  if (run.scheduleKey !== null && run.scheduleKey !== IngestionDay.key(now))
    return false;
  const [active] = await database
    .select({ id: ingestionRun.id })
    .from(ingestionRun)
    .where(and(eq(ingestionRun.activeSlot, 1), ne(ingestionRun.id, runId)))
    .limit(1);
  if (active) return false;
  if (run.scheduleKey === null) return true;
  const days = await loadIngestionSourceDays(database, run.scheduleKey);
  return IngestionSchedule.passComplete({
    days,
    enabledSources: days.flatMap((day) =>
      isIngestionSource(day.source) ? [day.source] : [],
    ),
  });
}

import { eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import type { IngestionSourceDay } from "./ingestion-schedule";
import { SourcePublication } from "./source-publication";

export async function loadIngestionSourceDays(
  database: LibSQLDatabase,
  scheduleKey: string,
): Promise<IngestionSourceDay[]> {
  const days = await database
    .select({
      source: ingestionSourceRun.source,
      // Done for the day once Turso holds accepted inventory, even while
      // search publication lags or is skipped.
      published: sql<number>`max(${SourcePublication.acceptedSql})`,
      attempts: sql<number>`count(*)`,
      lastStartedAt: sql<number | null>`max(${ingestionSourceRun.startedAt})`,
      lastCompletedAt: sql<number | null>`max(${ingestionRun.completedAt})`,
      validationRejected: sql<number>`max(${ingestionSourceRun.acceptanceStatus} = 'rejected' and ${ingestionSourceRun.validationErrors} is not null)`,
    })
    .from(ingestionSourceRun)
    .innerJoin(ingestionRun, eq(ingestionRun.id, ingestionSourceRun.runId))
    .where(eq(ingestionRun.scheduleKey, scheduleKey))
    .groupBy(ingestionSourceRun.source);
  return days.map((day) => ({
    ...day,
    published: day.published === 1,
    validationRejected: day.validationRejected === 1,
  }));
}

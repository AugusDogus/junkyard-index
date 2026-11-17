import { eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import type { IngestionSourceDay } from "./ingestion-schedule";

export async function loadIngestionSourceDays(
  database: LibSQLDatabase,
  scheduleKey: string,
): Promise<IngestionSourceDay[]> {
  const days = await database
    .select({
      source: ingestionSourceRun.source,
      published: sql<number>`max(${ingestionSourceRun.acceptanceStatus} = 'accepted' and ${ingestionRun.searchPublishedAt} is not null)`,
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

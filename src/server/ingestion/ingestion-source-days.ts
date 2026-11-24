import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import { MAX_INGESTION_CADENCE_DAYS } from "~/lib/ingestion-source";
import type { IngestionSourceDay, SourceCrawlDays } from "./ingestion-schedule";
import { SourcePublication } from "./source-publication";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Each source's latest run day and latest accepted run day (`schedule_key`)
 * among runs started in the last `MAX_INGESTION_CADENCE_DAYS` + 1 days, which
 * covers every rest `IngestionSchedule.scheduledSources` applies. A run dates
 * from the ingestion day it started on, even when it publishes after the next
 * day's boundary.
 */
export async function loadSourceCrawlDays(
  database: LibSQLDatabase,
  now: Date,
): Promise<Map<string, SourceCrawlDays>> {
  const rows = await database
    .select({
      source: ingestionSourceRun.source,
      lastAttemptDay: sql<string>`max(${ingestionRun.scheduleKey})`,
      lastAcceptedDay: sql<string | null>`max(case
        when ${SourcePublication.acceptedSql} then ${ingestionRun.scheduleKey}
      end)`,
    })
    .from(ingestionSourceRun)
    .innerJoin(ingestionRun, eq(ingestionRun.id, ingestionSourceRun.runId))
    .where(
      and(
        sql`${ingestionSourceRun.startedAt} > ${now.getTime() - (MAX_INGESTION_CADENCE_DAYS + 1) * DAY_MS}`,
        isNotNull(ingestionRun.scheduleKey),
      ),
    )
    // As in `loadSourceFreshness`: read the started_at range, not the whole
    // table in source-index order.
    .groupBy(sql`+${ingestionSourceRun.source}`);
  return new Map(
    rows.map(({ source, lastAttemptDay, lastAcceptedDay }) => [
      source,
      { lastAttemptDay, lastAcceptedDay },
    ]),
  );
}

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

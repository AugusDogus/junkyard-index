import { asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "~/lib/db";
import {
  ingestionRun,
  savedSearch,
  searchNotificationIntent,
  vehicleChange,
} from "~/schema";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { getSearchIndexCapabilities } from "~/server/ingestion/search-index-readiness";

export const statusRouter = createTRPCRouter({
  searchCapabilities: publicProcedure.query(getSearchIndexCapabilities),
  pipeline: publicProcedure.query(async () => {
    const now = Date.now();
    const [[active], [published], [projector], [alerts], [quarantined]] =
      await Promise.all([
        db
          .select({
            runId: ingestionRun.id,
            stage: ingestionRun.stage,
            lastProgressAt: ingestionRun.lastProgressAt,
          })
          .from(ingestionRun)
          .where(eq(ingestionRun.activeSlot, 1))
          // Sources stage in parallel and commit one at a time. Report the
          // committing run, else the staging run with the oldest progress.
          .orderBy(
            sql`${ingestionRun.commitStartedAt} is null`,
            asc(ingestionRun.lastProgressAt),
          )
          .limit(1),
        db
          .select({
            runId: ingestionRun.id,
            inventoryOutcome: ingestionRun.inventoryOutcome,
            searchPublishedAt: ingestionRun.searchPublishedAt,
          })
          .from(ingestionRun)
          .where(isNotNull(ingestionRun.searchPublishedAt))
          .orderBy(desc(ingestionRun.searchPublishedAt))
          .limit(1),
        db
          .select({ pending: sql<number>`count(*)` })
          .from(vehicleChange)
          .where(sql`${vehicleChange.processedAt} is null`),
        db
          .select({ pending: sql<number>`count(*)` })
          .from(searchNotificationIntent)
          .where(
            sql`${searchNotificationIntent.status} in ('pending', 'retry', 'sending')`,
          ),
        db
          .select({ count: sql<number>`count(*)` })
          .from(savedSearch)
          .where(
            sql`${savedSearch.alertQuarantineReason} is not null
                and (${savedSearch.emailAlertsEnabled} = 1
                  or ${savedSearch.discordAlertsEnabled} = 1)`,
          ),
      ]);
    return {
      inventory: {
        outcome: published?.inventoryOutcome ?? "unpublished",
        activeStage: active?.stage ?? null,
        lastProgressAgeMs: active
          ? now - active.lastProgressAt.getTime()
          : null,
      },
      search: {
        publishedRunId: published?.runId ?? null,
        publicationAgeMs: published?.searchPublishedAt
          ? now - published.searchPublishedAt.getTime()
          : null,
        pendingChanges: projector?.pending ?? 0,
      },
      alerts: {
        pendingIntents: alerts?.pending ?? 0,
        quarantinedSearches: quarantined?.count ?? 0,
      },
    };
  }),
});

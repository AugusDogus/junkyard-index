import { asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { env } from "~/env";
import { db } from "~/lib/db";
import type { IngestionSource } from "~/lib/ingestion-source";
import {
  ingestionRun,
  savedSearch,
  searchNotificationIntent,
  vehicleChange,
} from "~/schema";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { getSearchIndexCapabilities } from "~/server/ingestion/search-index-readiness";
import { getDurableSourceFreshness } from "~/server/ingestion/durable-ingestion";
import { providerFreshness } from "~/server/ingestion/provider-freshness";
import { worstStatus, type IngestionStatus } from "./status-utils";

type SourceKey = IngestionSource;

interface ProviderStatus {
  name: string;
  source: SourceKey;
  status: IngestionStatus;
  lastPublishedAt: string | null;
}

interface StatusResponse {
  aggregateStatus: IngestionStatus;
  providers: ProviderStatus[];
  statusPageUrl: string | null;
}

async function getProviderStatusInternal(): Promise<StatusResponse> {
  const now = new Date();
  const providers = providerFreshness(
    await getDurableSourceFreshness(now),
    now,
  ).map(
    (provider): ProviderStatus => ({
      name: provider.name,
      source: provider.source,
      status: provider.fresh ? "operational" : "degraded",
      lastPublishedAt: provider.lastPublishedAt?.toISOString() ?? null,
    }),
  );
  return {
    aggregateStatus: worstStatus(providers.map((p) => p.status)),
    providers,
    statusPageUrl: env.NEXT_PUBLIC_STATUS_PAGE_URL ?? null,
  };
}

const getProviderStatus = unstable_cache(
  getProviderStatusInternal,
  ["provider-status"],
  // Freshness changes only when a source publishes.
  { revalidate: 300 },
);

export const statusRouter = createTRPCRouter({
  searchCapabilities: publicProcedure.query(getSearchIndexCapabilities),
  providers: publicProcedure.query(async () => {
    return getProviderStatus();
  }),
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

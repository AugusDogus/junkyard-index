import { desc, eq, isNotNull, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { env } from "~/env";
import { db } from "~/lib/db";
import {
  INGESTION_SOURCE_DISPLAY_NAMES,
  INGESTION_SOURCES,
  type IngestionSource,
} from "~/lib/ingestion-source";
import {
  ingestionRun,
  ingestionSourceRun,
  savedSearch,
  searchNotificationIntent,
  vehicleChange,
} from "~/schema";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { getVinPatternSearchReadiness } from "~/server/ingestion/search-index-readiness";
import {
  mapRunStatus,
  parseErrors,
  worstStatus,
  type IngestionStatus,
} from "./status-utils";

type SourceKey = IngestionSource;

interface ProviderStatus {
  name: string;
  source: SourceKey;
  status: IngestionStatus;
  lastRunAt: string | null;
  errors: string[] | null;
  vehiclesProcessed: number;
}

interface StatusResponse {
  aggregateStatus: IngestionStatus;
  providers: ProviderStatus[];
  statusPageUrl: string | null;
}

async function getProviderStatusInternal(): Promise<StatusResponse> {
  const latestRuns = await Promise.all(
    INGESTION_SOURCES.map(async (source) => {
      const [latestRun] = await db
        .select({
          status: ingestionSourceRun.status,
          completedAt: ingestionSourceRun.completedAt,
          startedAt: ingestionSourceRun.startedAt,
          errors: ingestionSourceRun.errors,
          acceptanceStatus: ingestionSourceRun.acceptanceStatus,
          validationErrors: ingestionSourceRun.validationErrors,
          vehiclesProcessed: ingestionSourceRun.vehiclesProcessed,
        })
        .from(ingestionSourceRun)
        .where(eq(ingestionSourceRun.source, source))
        .orderBy(desc(ingestionSourceRun.startedAt))
        .limit(1);

      return { source, latestRun };
    }),
  );

  const providers = latestRuns.map(({ source, latestRun }): ProviderStatus => {
    if (!latestRun) {
      return {
        name: INGESTION_SOURCE_DISPLAY_NAMES[source],
        source,
        status: "operational",
        lastRunAt: null,
        errors: null,
        vehiclesProcessed: 0,
      };
    }

    const lastRunAt = latestRun.completedAt ?? latestRun.startedAt;

    return {
      name: INGESTION_SOURCE_DISPLAY_NAMES[source],
      source,
      status:
        latestRun.acceptanceStatus === "rejected"
          ? "degraded"
          : mapRunStatus(latestRun.status),
      lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
      errors:
        parseErrors(latestRun.validationErrors) ??
        parseErrors(latestRun.errors),
      vehiclesProcessed: latestRun.vehiclesProcessed,
    };
  });

  return {
    aggregateStatus: worstStatus(providers.map((p) => p.status)),
    providers,
    statusPageUrl: env.NEXT_PUBLIC_STATUS_PAGE_URL ?? null,
  };
}

const getProviderStatus = unstable_cache(
  getProviderStatusInternal,
  ["provider-status"],
  { revalidate: 10 },
);

export const statusRouter = createTRPCRouter({
  searchCapabilities: publicProcedure.query(async () => ({
    vinPatternSearchReady: await getVinPatternSearchReadiness(),
  })),
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

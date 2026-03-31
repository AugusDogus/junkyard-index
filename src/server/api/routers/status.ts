import { eq, desc } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { env } from "~/env";
import { db } from "~/lib/db";
import { ingestionSourceRun } from "~/schema";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  mapRunStatus,
  parseErrors,
  worstStatus,
  type IngestionStatus,
} from "./status-utils";

const SOURCES = [
  "pyp",
  "row52",
  "autorecycler",
  "pullapart",
  "upullitne",
] as const;
type SourceKey = (typeof SOURCES)[number];

const SOURCE_DISPLAY_NAMES: Record<SourceKey, string> = {
  pyp: "LKQ Pick Your Part",
  row52: "Row52",
  autorecycler: "AutoRecycler.io",
  pullapart: "Pull-A-Part / U-Pull-&-Pay",
  upullitne: "U Pull-It Nebraska",
};

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
  const providers: ProviderStatus[] = [];

  for (const source of SOURCES) {
    const [latestRun] = await db
      .select({
        status: ingestionSourceRun.status,
        completedAt: ingestionSourceRun.completedAt,
        startedAt: ingestionSourceRun.startedAt,
        errors: ingestionSourceRun.errors,
        vehiclesProcessed: ingestionSourceRun.vehiclesProcessed,
      })
      .from(ingestionSourceRun)
      .where(eq(ingestionSourceRun.source, source))
      .orderBy(desc(ingestionSourceRun.startedAt))
      .limit(1);

    if (!latestRun) {
      providers.push({
        name: SOURCE_DISPLAY_NAMES[source],
        source,
        status: "operational",
        lastRunAt: null,
        errors: null,
        vehiclesProcessed: 0,
      });
      continue;
    }

    const lastRunAt = latestRun.completedAt ?? latestRun.startedAt;

    providers.push({
      name: SOURCE_DISPLAY_NAMES[source],
      source,
      status: mapRunStatus(latestRun.status),
      lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
      errors: parseErrors(latestRun.errors),
      vehiclesProcessed: latestRun.vehiclesProcessed,
    });
  }

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
  providers: publicProcedure.query(async () => {
    return getProviderStatus();
  }),
});

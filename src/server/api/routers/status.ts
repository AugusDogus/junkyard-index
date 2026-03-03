import { and, desc, eq, ne } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { env } from "~/env";
import { db } from "~/lib/db";
import { ingestionSourceRun } from "~/schema";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

const SOURCES = ["pyp", "row52"] as const;
type SourceKey = (typeof SOURCES)[number];

const SOURCE_DISPLAY_NAMES: Record<SourceKey, string> = {
  pyp: "LKQ Pick Your Part",
  row52: "Row52",
};

type IngestionStatus = "operational" | "degraded" | "down";

function mapRunStatus(status: string): IngestionStatus {
  switch (status) {
    case "success":
      return "operational";
    case "partial":
      return "degraded";
    case "error":
      return "down";
    default:
      return "operational";
  }
}

const STATUS_SEVERITY: Record<IngestionStatus, number> = {
  operational: 0,
  degraded: 1,
  down: 2,
};

function worstStatus(statuses: IngestionStatus[]): IngestionStatus {
  let worst: IngestionStatus = "operational";
  for (const s of statuses) {
    if (STATUS_SEVERITY[s] > STATUS_SEVERITY[worst]) {
      worst = s;
    }
  }
  return worst;
}

function parseErrors(errorsJson: string | null): string[] | null {
  if (!errorsJson) return null;
  try {
    const parsed: unknown = JSON.parse(errorsJson);
    if (Array.isArray(parsed)) {
      return parsed.filter((e): e is string => typeof e === "string");
    }
    return null;
  } catch {
    return null;
  }
}

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
      .where(
        and(
          eq(ingestionSourceRun.source, source),
          ne(ingestionSourceRun.status, "running"),
        ),
      )
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
  { revalidate: 300 },
);

export const statusRouter = createTRPCRouter({
  providers: publicProcedure.query(async () => {
    return getProviderStatus();
  }),
});

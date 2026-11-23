import { z } from "zod";
import { AlgoliaDeployment } from "~/lib/algolia-deployment";
import { AdminSeries } from "./admin-series";

/**
 * Algolia's free plan. Its search requests per period cannot be read on
 * this plan: the Usage API needs a key with the "usage" ACL and a Premium
 * plan, and Analytics keeps only 7 days (checked Nov 22, 2026).
 */
export const ALGOLIA_FREE_PLAN = {
  searchRequestsPerMonth: 10_000,
  records: 1_000_000,
} as const;

/** Days of top searches Analytics keeps on the free plan. */
export const ALGOLIA_ANALYTICS_DAYS = 7;
export const ALGOLIA_TOP_SEARCHES = 20;
/** Read per index before adding indices together; Analytics allows 1,000. */
const ALGOLIA_TOP_SEARCHES_PER_INDEX = 100;

export type AlgoliaAccess = {
  appId: string;
  /** The server write (admin) key. Never sent anywhere but Algolia. */
  apiKey: string;
  deployment: AlgoliaDeployment;
};

/**
 * Only production may hold the production app's write key, so other
 * deployments reading the production app get `production_only`.
 */
export type AlgoliaReading<Value> =
  | { kind: "read"; value: Value }
  | { kind: "production_only" };

export type TopSearch = {
  /** What was typed; empty for browsing without a query. */
  query: string;
  count: number;
};

type Fetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<Response>;

const IndicesSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      entries: z.number(),
      virtual: z.boolean().optional(),
    }),
  ),
});

const TopSearchesSchema = z.object({
  searches: z.array(z.object({ search: z.string(), count: z.number() })),
});

/**
 * One read-only GET. Neither endpoint used here is a search, so neither
 * spends the plan's search requests.
 */
async function getJson<Schema extends z.ZodTypeAny>(
  access: AlgoliaAccess,
  fetch: Fetch,
  operation: string,
  url: string,
  schema: Schema,
): Promise<z.infer<Schema>> {
  const response = await fetch(url, {
    headers: {
      "X-Algolia-Application-Id": access.appId,
      "X-Algolia-API-Key": access.apiKey,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
        ? body.message
        : "no message";
    throw new Error(
      `Algolia ${operation} answered HTTP ${response.status}: ${message}. Nothing was changed. Check that ALGOLIA_WRITE_API_KEY still exists and has this permission in the Algolia dashboard (API Keys).`,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      `Algolia ${operation} answered in a shape the admin dashboard does not expect. Nothing was changed. Compare the response with src/server/admin/algolia-budget.ts. Problems: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

function allowed(access: AlgoliaAccess): boolean {
  return (
    AlgoliaDeployment.adminAccess(access.deployment, access.appId).kind ===
    "allowed"
  );
}

export const AlgoliaBudget = {
  /** Records stored across the app. Virtual replicas hold none of their own. */
  async records(
    access: AlgoliaAccess,
    fetch: Fetch,
  ): Promise<AlgoliaReading<number>> {
    if (!allowed(access)) return { kind: "production_only" };
    const { items } = await getJson(
      access,
      fetch,
      "list indices",
      `https://${access.appId}.algolia.net/1/indexes`,
      IndicesSchema,
    );
    return {
      kind: "read",
      value: items
        .filter((index) => index.virtual !== true)
        .reduce((sum, index) => sum + index.entries, 0),
    };
  },

  /**
   * The 20 most searched queries over the last 7 UTC days. Analytics counts
   * each sort's replica as its own index (the site's default sort is a
   * replica), so each index's top 100 are read and added together.
   */
  async topSearches(
    access: AlgoliaAccess,
    indexNames: readonly string[],
    now: Date,
    fetch: Fetch,
  ): Promise<AlgoliaReading<TopSearch[]>> {
    if (!allowed(access)) return { kind: "production_only" };
    const days = AdminSeries.lastDays(now, ALGOLIA_ANALYTICS_DAYS);
    const lists = await Promise.all(
      indexNames.map((indexName) => {
        const params = new URLSearchParams({
          index: indexName,
          startDate: days[0] ?? AdminSeries.dayKey(now),
          endDate: AdminSeries.dayKey(now),
          limit: String(ALGOLIA_TOP_SEARCHES_PER_INDEX),
        });
        return getJson(
          access,
          fetch,
          `Analytics top searches for index ${indexName}`,
          `https://analytics.algolia.com/2/searches?${params.toString()}`,
          TopSearchesSchema,
        );
      }),
    );
    const totals = new Map<string, number>();
    for (const { searches } of lists) {
      for (const { search, count } of searches) {
        totals.set(search, (totals.get(search) ?? 0) + count);
      }
    }
    return {
      kind: "read",
      value: [...totals]
        .map(([query, count]) => ({ query, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, ALGOLIA_TOP_SEARCHES),
    };
  },
} as const;

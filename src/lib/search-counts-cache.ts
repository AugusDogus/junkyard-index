import type {
  LegacySearchMethodProps,
  LiteClient,
  SearchMethodParams,
  SearchResponse,
} from "algoliasearch/lite";
import { z } from "zod";

const lifetime = 5 * 60_000;
const countSchema = z.object({
  key: z.string(),
  savedAt: z.number(),
  result: z.object({
    hits: z.array(z.never()),
    facets: z.record(z.string(), z.record(z.string(), z.number())).optional(),
    facets_stats: z
      .record(
        z.string(),
        z.object({
          min: z.number(),
          max: z.number(),
          avg: z.number(),
          sum: z.number(),
        }),
      )
      .optional(),
    nbHits: z.number().optional(),
    nbPages: z.number().optional(),
    page: z.number().optional(),
    hitsPerPage: z.number().optional(),
    exhaustiveNbHits: z.boolean().optional(),
    exhaustiveFacetsCount: z.boolean().optional(),
    processingTimeMS: z.number().optional(),
    index: z.string().optional(),
    query: z.string().optional(),
    params: z.string().optional(),
  }),
});
const hydrationSchema = z.object({
  searchCounts: z.array(countSchema).optional(),
});

/** Reuse page-zero facet/count searches while fetching each hits page normally. */
export function withSearchCountsCache<
  Client extends Pick<LiteClient, "search">,
>(client: Client) {
  type Entry = { key: string; savedAt: number; result: SearchResponse<never> };
  const cache = new Map<string, Entry>();
  const remember = (entry: Entry) => {
    cache.delete(entry.key);
    cache.set(entry.key, entry);
    if (cache.size > 64) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
  };
  return {
    ...client,
    primeCounts(userData: unknown) {
      if (!Array.isArray(userData)) return;
      const items: unknown[] = userData;
      for (const data of items) {
        const parsed = hydrationSchema.safeParse(data);
        if (!parsed.success) continue;
        for (const entry of parsed.data.searchCounts ?? []) {
          if (Date.now() - entry.savedAt < lifetime) remember(entry);
        }
      }
    },
    async search<T>(
      input: SearchMethodParams | LegacySearchMethodProps,
      requestOptions?: Parameters<LiteClient["search"]>[1],
    ) {
      const requests = Array.isArray(input) ? input : input.requests;
      const keys = requests.map((request) => {
        const params = "params" in request ? request.params : request;
        if (
          request.type === "facet" ||
          typeof params !== "object" ||
          !("hitsPerPage" in params) ||
          params.hitsPerPage !== 0
        )
          return null;
        return JSON.stringify([
          request.indexName,
          Object.fromEntries(
            Object.entries(params)
              .filter(([name]) => name !== "page")
              .sort(([a], [b]) => a.localeCompare(b)),
          ),
        ]);
      });
      const cached = keys.map((key) => {
        const entry = key === null ? undefined : cache.get(key);
        return entry && Date.now() - entry.savedAt < lifetime
          ? entry
          : undefined;
      });
      const pending = Array.isArray(input)
        ? input.filter((_, index) => !cached[index])
        : {
            ...input,
            requests: input.requests.filter((_, index) => !cached[index]),
          };
      const pendingCount = Array.isArray(pending)
        ? pending.length
        : pending.requests.length;
      const response = pendingCount
        ? await client.search<T>(pending, requestOptions)
        : { results: [] };
      let next = 0;
      const results = requests.map((_, index) => {
        const entry = cached[index];
        const result = entry?.result ?? response.results[next++];
        if (!result)
          throw new Error(
            "Algolia omitted a requested search result. Retry the search.",
          );
        const key = keys[index];
        if (key && !entry && "hits" in result)
          remember({
            key,
            savedAt: Date.now(),
            result: { ...result, hits: [] },
          });
        return result;
      });
      // Carry only this batch's counts through SSR. The browser seeds its own
      // cache from userData, so even its first scroll sends only the hits query.
      const searchCounts = keys.flatMap((key) => {
        const entry = key === null ? undefined : cache.get(key);
        return entry ? [entry] : [];
      });
      return {
        ...response,
        results: results.map((result, index) =>
          index === 0 && "hits" in result && typeof window === "undefined"
            ? {
                ...result,
                userData: [...(result.userData ?? []), { searchCounts }],
              }
            : result,
        ),
      };
    },
  };
}

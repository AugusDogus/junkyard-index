import { Effect } from "effect";
import {
  buildGlobalMsearchBody,
  postAutorecyclerElasticsearchMsearch,
  type AutorecyclerMsearchHit,
  type AutorecyclerMsearchResponse,
} from "./autorecycler-client";
import type { ConnectorChunkResult } from "./connector-chunk";
import { createAutorecyclerOrgGeoResolver } from "./autorecycler-geo";
import { transformAutorecyclerMsearchHit } from "./autorecycler-transform";
import type { CanonicalVehicle } from "./types";
import { AutorecyclerProviderError } from "./errors";
import type { PersistenceError } from "./errors";
import type { Database } from "./context";

/**
 * msearch `search.n` (requested page size). Live probe (2025-03) returns at most **400** hits
 * per response regardless of larger `n`; use 400 to match the server cap. Pagination must
 * advance `from` by **hits returned** ({@link streamAutorecyclerInventory} does this), not by
 * this constant alone, so rows are never skipped if the cap changes.
 */
const REQUESTED_PAGE_SIZE = 400;
const PAGE_FETCH_CONCURRENCY = 4;
const PAGE_FETCH_CHUNK_SIZE = 10;

function hitSource(
  hit: AutorecyclerMsearchHit,
): Record<string, unknown> | null {
  const src = hit._source;
  if (!src || typeof src !== "object") return null;
  return src as Record<string, unknown>;
}

/** Same normalization as {@link transformAutorecyclerMsearchHit} (trimmed org id). */
function autorecyclerOrgLookupKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

type MsearchFirstPage =
  | {
      ok: true;
      r0: { at_end?: boolean; hits: { hits: AutorecyclerMsearchHit[] } };
      hits: AutorecyclerMsearchHit[];
    }
  | { ok: false; logMessage: string; detail: string };

/** Runtime-validate msearch `responses[0].hits.hits` so empty/malformed payloads are not treated as EOF. */
function parseMsearchFirstResponse(
  json: AutorecyclerMsearchResponse,
  from: number,
): MsearchFirstPage {
  const responses = json.responses;
  if (!Array.isArray(responses)) {
    const detail =
      responses === undefined
        ? "responses missing"
        : `responses not an array (${typeof responses})`;
    return {
      ok: false,
      logMessage: `[AutoRecycler] msearch malformed at from=${from}: ${detail}`,
      detail,
    };
  }
  if (responses.length < 1) {
    const detail = "responses empty (length 0)";
    return {
      ok: false,
      logMessage: `[AutoRecycler] msearch malformed at from=${from}: ${detail}`,
      detail,
    };
  }

  const r0 = responses[0];
  if (
    r0 === undefined ||
    r0 === null ||
    typeof r0 !== "object" ||
    Array.isArray(r0)
  ) {
    const detailResponses = "responses[0] missing or not an object";
    return {
      ok: false,
      logMessage: `[AutoRecycler] msearch malformed at from=${from}: ${detailResponses}`,
      detail: detailResponses,
    };
  }

  const hitsObj = r0.hits;
  if (
    hitsObj === null ||
    typeof hitsObj !== "object" ||
    Array.isArray(hitsObj)
  ) {
    const detailHits = "responses[0].hits missing or not an object";
    return {
      ok: false,
      logMessage: `[AutoRecycler] msearch malformed at from=${from}: ${detailHits}`,
      detail: detailHits,
    };
  }

  const hitsRaw = hitsObj.hits;
  if (!Array.isArray(hitsRaw)) {
    const detailArr = "responses[0].hits.hits is not an array";
    return {
      ok: false,
      logMessage: `[AutoRecycler] msearch malformed at from=${from}: ${detailArr}`,
      detail: detailArr,
    };
  }

  return {
    ok: true,
    r0: r0 as { at_end?: boolean; hits: { hits: AutorecyclerMsearchHit[] } },
    hits: hitsRaw as AutorecyclerMsearchHit[],
  };
}

export type AutorecyclerStreamResult = ConnectorChunkResult<
  "autorecycler",
  number
> & {
  geoStats: ReturnType<
    ReturnType<typeof createAutorecyclerOrgGeoResolver>["getStats"]
  >;
};

interface AutorecyclerStreamOptions<E, R> {
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  startFrom?: number;
  maxPages?: number;
}

type AutorecyclerPageFetcher = (
  from: number,
  pageSize: number,
) => Promise<AutorecyclerMsearchResponse>;

/**
 * Stream AutoRecycler global inventory via encrypted `msearch`, resolve yard
 * coordinates via cached `init/data` on representative `details/{inventory_id}` rows.
 */
export function streamAutorecyclerInventoryWithPageFetcher<E, R>(
  options: AutorecyclerStreamOptions<E, R>,
  fetchPage: AutorecyclerPageFetcher,
): Effect.Effect<
  AutorecyclerStreamResult,
  AutorecyclerProviderError | PersistenceError | E,
  Database | R
> {
  return Effect.gen(function* () {
    yield* Effect.logInfo("[AutoRecycler] Starting stream");

    const geo = createAutorecyclerOrgGeoResolver();
    let from = Math.max(0, options.startFrom ?? 0);
    let pagesProcessed = 0;
    let totalCanonical = 0;
    let done = false;
    const errors: string[] = [];

    const maxPages = Math.max(1, options.maxPages ?? Number.MAX_SAFE_INTEGER);

    const processPage = (
      requestFrom: number,
      json: AutorecyclerMsearchResponse,
    ): Effect.Effect<
      { full: boolean; terminal: boolean },
      AutorecyclerProviderError | PersistenceError | E,
      Database | R
    > =>
      Effect.gen(function* () {
        const parsed = parseMsearchFirstResponse(json, requestFrom);
        if (!parsed.ok) {
          yield* Effect.logError(parsed.logMessage);
          return yield* Effect.fail(
            new AutorecyclerProviderError({
              from: requestFrom,
              cause: new Error(parsed.detail),
            }),
          );
        }

        const { r0, hits } = parsed;
        const seeds = new Map<string, string>();
        for (const h of hits) {
          const src = hitSource(h);
          if (!src) continue;
          const orgKey = autorecyclerOrgLookupKey(
            src.organization_custom_organization,
          );
          const invKey = autorecyclerOrgLookupKey(src.inventory_id_text);
          if (orgKey && invKey) {
            if (!geo.getCached(orgKey) && !seeds.has(orgKey)) {
              seeds.set(orgKey, invKey);
            }
          }
        }

        yield* geo.resolveBatchEffect(seeds);

        const pageCanonical: CanonicalVehicle[] = [];
        for (const h of hits) {
          const src = hitSource(h);
          if (!src) continue;
          const orgKey = autorecyclerOrgLookupKey(
            src.organization_custom_organization,
          );
          if (!orgKey) continue;
          const g = geo.getCached(orgKey);
          if (!g) continue;
          const c = transformAutorecyclerMsearchHit(src, g);
          if (c) pageCanonical.push(c);
        }

        if (pageCanonical.length > 0) {
          yield* options.onBatch(pageCanonical);
        }

        totalCanonical += pageCanonical.length;
        pagesProcessed += 1;
        from += hits.length;

        return {
          full: hits.length === REQUESTED_PAGE_SIZE,
          terminal: r0.at_end === true || hits.length === 0,
        };
      });

    const fetchPageEffect = (requestFrom: number) =>
      Effect.tryPromise({
        try: () => fetchPage(requestFrom, REQUESTED_PAGE_SIZE),
        catch: (cause) =>
          new AutorecyclerProviderError({ from: requestFrom, cause }),
      });

    while (!done && pagesProcessed < maxPages) {
      const firstRequestFrom = from;
      const first = yield* fetchPageEffect(firstRequestFrom);
      const firstResult = yield* processPage(firstRequestFrom, first);
      if (firstResult.terminal) {
        done = true;
        break;
      }
      if (!firstResult.full || pagesProcessed >= maxPages) continue;

      const tailCount = Math.min(
        PAGE_FETCH_CHUNK_SIZE - 1,
        maxPages - pagesProcessed,
      );
      const tailOffsets = Array.from(
        { length: tailCount },
        (_, index) => from + index * REQUESTED_PAGE_SIZE,
      );
      const tailPages = yield* Effect.all(
        tailOffsets.map((requestFrom) =>
          fetchPageEffect(requestFrom).pipe(
            Effect.map((json) => ({ requestFrom, json })),
          ),
        ),
        { concurrency: PAGE_FETCH_CONCURRENCY },
      );

      for (const page of tailPages) {
        if (page.requestFrom !== from) break;
        const pageResult = yield* processPage(page.requestFrom, page.json);
        if (pageResult.terminal) {
          done = true;
          break;
        }
        if (!pageResult.full) break;
      }
    }

    yield* Effect.logInfo(
      `[AutoRecycler] ${done ? "Completed" : "Paused"} pages=${pagesProcessed} vehicles=${totalCanonical} geo=${JSON.stringify(geo.getStats())}`,
    );

    return {
      source: "autorecycler" as const,
      status: done ? "complete" : "paused",
      cursor: from,
      count: totalCanonical,
      errors,
      pagesProcessed,
      geoStats: geo.getStats(),
    };
  });
}

export function streamAutorecyclerInventory<E, R>(
  options: AutorecyclerStreamOptions<E, R>,
): Effect.Effect<
  AutorecyclerStreamResult,
  AutorecyclerProviderError | PersistenceError | E,
  Database | R
> {
  return streamAutorecyclerInventoryWithPageFetcher(options, (from, pageSize) =>
    postAutorecyclerElasticsearchMsearch(
      buildGlobalMsearchBody(from, pageSize),
    ),
  );
}

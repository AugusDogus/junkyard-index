import { Effect } from "effect";
import {
  buildGlobalMsearchBody,
  postAutorecyclerElasticsearchMsearch,
  type AutorecyclerMsearchHit,
  type AutorecyclerMsearchResponse,
} from "./autorecycler-client";
import { DEFAULT_INGESTION_PROGRESS_PAGE_INTERVAL } from "./constants";
import { createAutorecyclerOrgGeoResolver } from "./autorecycler-geo";
import { transformAutorecyclerMsearchHit } from "./autorecycler-transform";
import type { CanonicalVehicle } from "./types";
import { AutorecyclerProviderError } from "./errors";
import type { PersistenceError } from "./errors";
import type { Database } from "./runtime";

/**
 * msearch `search.n` (requested page size). Live probe (2025-03) returns at most **400** hits
 * per response regardless of larger `n`; use 400 to match the server cap. Pagination must
 * advance `from` by **hits returned** ({@link streamAutorecyclerInventory} does this), not by
 * this constant alone, so rows are never skipped if the cap changes.
 */
const REQUESTED_PAGE_SIZE = 400;

function hitSource(hit: AutorecyclerMsearchHit): Record<string, unknown> | null {
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

export interface AutorecyclerStreamResult {
  source: "autorecycler";
  count: number;
  errors: string[];
  pagesProcessed: number;
  nextFrom: number;
  done: boolean;
  fullyExhausted: boolean;
  stopped: boolean;
  geoStats: ReturnType<
    ReturnType<typeof createAutorecyclerOrgGeoResolver>["getStats"]
  >;
}

/**
 * Stream AutoRecycler global inventory via encrypted `msearch`, resolve yard
 * coordinates via cached `init/data` on representative `details/{inventory_id}` rows.
 */
export function streamAutorecyclerInventory<E, R>(options: {
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  startFrom?: number;
  pagesPerChunk?: number;
  /**
   * Optional hook for `run-pipeline.ts` (in-memory `latest*` on failure + throttled
   * `updateSourceRunProgress`). Throttled by `pagesPerChunk`, or
   * `DEFAULT_INGESTION_PROGRESS_PAGE_INTERVAL` if omitted; last page always emits.
   */
  onProgress?: (progress: {
    nextFrom: number;
    pagesProcessed: number;
    vehiclesProcessed: number;
    stopped: boolean;
    errors: string[];
  }) => Effect.Effect<void, E, R>;
}): Effect.Effect<
  AutorecyclerStreamResult,
  AutorecyclerProviderError | PersistenceError | E,
  Database | R
> {
  return Effect.gen(function* () {
    const geo = createAutorecyclerOrgGeoResolver();
    const progressEveryPages = Math.max(
      1,
      options.pagesPerChunk ?? DEFAULT_INGESTION_PROGRESS_PAGE_INTERVAL,
    );
    let from = Math.max(0, options.startFrom ?? 0);
    let pagesProcessed = 0;
    let totalCanonical = 0;
    let done = false;
    let fullyExhausted = false;
    let lastProgressPages = 0;
    const errors: string[] = [];

    const emitProgress = (force: boolean): Effect.Effect<void, E, R> => {
      if (!options.onProgress) return Effect.succeed(undefined);
      if (!force && pagesProcessed - lastProgressPages < progressEveryPages) {
        return Effect.succeed(undefined);
      }
      lastProgressPages = pagesProcessed;
      return options.onProgress({
        nextFrom: from,
        pagesProcessed,
        vehiclesProcessed: totalCanonical,
        stopped: false,
        errors,
      });
    };

    while (!done) {
      const json = yield* Effect.tryPromise({
        try: () =>
          postAutorecyclerElasticsearchMsearch(
            buildGlobalMsearchBody(from, REQUESTED_PAGE_SIZE),
          ),
        catch: (cause) => new AutorecyclerProviderError({ from, cause }),
      });

      const parsed = parseMsearchFirstResponse(json, from);
      if (!parsed.ok) {
        yield* Effect.logError(parsed.logMessage);
        yield* Effect.fail(
          new AutorecyclerProviderError({
            from,
            cause: new Error(parsed.detail),
          }),
        );
      } else {
        const { r0, hits } = parsed;

        /** Org -> representative inventory id for geo resolution */
        const seeds = new Map<string, string>();
        for (const h of hits) {
          const src = hitSource(h);
          if (!src) continue;
          const orgKey = autorecyclerOrgLookupKey(src.organization_custom_organization);
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
          const orgKey = autorecyclerOrgLookupKey(src.organization_custom_organization);
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

        const atEnd = r0.at_end === true;
        if (atEnd || hits.length === 0) {
          fullyExhausted = atEnd;
          done = true;
        }

        yield* emitProgress(done);
      }
    }

    yield* Effect.logInfo(
      `[AutoRecycler] Completed pages=${pagesProcessed} vehicles=${totalCanonical} geo=${JSON.stringify(geo.getStats())}`,
    );

    return {
      source: "autorecycler" as const,
      count: totalCanonical,
      errors,
      pagesProcessed,
      nextFrom: from,
      done,
      fullyExhausted,
      stopped: false,
      geoStats: geo.getStats(),
    };
  });
}

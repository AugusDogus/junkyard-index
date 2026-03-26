import { Duration, Effect } from "effect";
import {
  buildGlobalMsearchBody,
  postAutorecyclerElasticsearchMsearch,
  type AutorecyclerMsearchHit,
} from "./autorecycler-client";
import { createAutorecyclerOrgGeoResolver } from "./autorecycler-geo";
import { transformAutorecyclerMsearchHit } from "./autorecycler-transform";
import type { CanonicalVehicle } from "./types";
import { AutorecyclerProviderError } from "./errors";
import type { PersistenceError } from "./errors";
import type { Database } from "./runtime";

const PAGE_SIZE = 50;
const PAGE_DELAY_MS = 120;
const PROGRESS_EVERY_PAGES = 10;
/** Safety cap — raise if inventory grows beyond this many pages. */
const MAX_PAGES = 50_000;

function hitSource(hit: AutorecyclerMsearchHit): Record<string, unknown> | null {
  const src = hit._source;
  if (!src || typeof src !== "object") return null;
  return src as Record<string, unknown>;
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
    const progressEveryPages = Math.max(1, options.pagesPerChunk ?? PROGRESS_EVERY_PAGES);
    let from = Math.max(0, options.startFrom ?? 0);
    let pagesProcessed = 0;
    let totalCanonical = 0;
    let done = false;
    let fullyExhausted = false;
    let stopped = false;
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
        stopped,
        errors,
      });
    };

    while (!done && pagesProcessed < MAX_PAGES) {
      const json = yield* Effect.tryPromise({
        try: () =>
          postAutorecyclerElasticsearchMsearch(
            buildGlobalMsearchBody(from, PAGE_SIZE),
          ),
        catch: (cause) => new AutorecyclerProviderError({ from, cause }),
      });

      const r0 = json.responses?.[0];
      const hits = r0?.hits?.hits ?? [];

      /** Org -> representative inventory id for geo resolution */
      const seeds = new Map<string, string>();
      for (const h of hits) {
        const src = hitSource(h);
        if (!src) continue;
        const org = src.organization_custom_organization;
        const inv = src.inventory_id_text;
        if (typeof org === "string" && typeof inv === "string") {
          if (!geo.getCached(org) && !seeds.has(org)) {
            seeds.set(org, inv);
          }
        }
      }

      yield* geo.resolveBatchEffect(seeds);

      const pageCanonical: CanonicalVehicle[] = [];
      for (const h of hits) {
        const src = hitSource(h);
        if (!src) continue;
        const org =
          typeof src.organization_custom_organization === "string"
            ? src.organization_custom_organization
            : "";
        const g = org ? geo.getCached(org) : undefined;
        if (!g) continue;
        const c = transformAutorecyclerMsearchHit(src, g);
        if (c) pageCanonical.push(c);
      }

      if (pageCanonical.length > 0) {
        yield* options.onBatch(pageCanonical);
      }

      totalCanonical += pageCanonical.length;
      pagesProcessed += 1;
      from += PAGE_SIZE;

      const atEnd = r0?.at_end === true;
      if (atEnd || hits.length === 0) {
        fullyExhausted = atEnd;
        done = true;
      } else if (PAGE_DELAY_MS > 0) {
        yield* Effect.sleep(Duration.millis(PAGE_DELAY_MS));
      }

      yield* emitProgress(done);
    }

    if (!done && pagesProcessed >= MAX_PAGES) {
      const msg = `[AutoRecycler] Stopped: exceeded max pages (${MAX_PAGES})`;
      yield* Effect.logWarning(msg);
      errors.push(msg);
      stopped = true;
      done = true;
      yield* emitProgress(true);
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
      stopped,
      geoStats: geo.getStats(),
    };
  });
}

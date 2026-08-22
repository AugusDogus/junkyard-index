import { Effect } from "effect";
import { fetchInventoryPage } from "./crush-mvc-client";
import {
  CRUSH_MVC_SITES,
  type CrushMvcSiteConfig,
  type CrushMvcYard,
} from "./crush-mvc-config";
import type { ConnectorChunkStatus } from "./connector-chunk";
import { CrushMvcProviderError } from "./errors";
import {
  parseCrushInventoryHtml,
  type RawCrushListing,
} from "./crush-mvc-transform";

export interface CrushMvcStreamResult {
  source: "crush-mvc";
  status: ConnectorChunkStatus;
  cursor: number;
  count: number;
  errors: string[];
  pagesProcessed: number;
}

interface CrushMvcPageTarget {
  siteIndex: number;
  site: CrushMvcSiteConfig;
  yardIndex: number;
  yard: CrushMvcYard;
}

function listingKey(listing: RawCrushListing): string {
  return [
    listing.sourceUrl,
    String(listing.yardId ?? ""),
    String(listing.year),
    listing.make,
    listing.model,
    listing.color ?? "",
    listing.reference ?? "",
    listing.row ?? "",
    listing.arrivalDate ?? "",
  ].join("|");
}

function flattenPageTargets(
  sites: readonly CrushMvcSiteConfig[],
): CrushMvcPageTarget[] {
  const targets: CrushMvcPageTarget[] = [];
  for (const [siteIndex, site] of sites.entries()) {
    for (const [yardIndex, yard] of site.yards.entries()) {
      targets.push({ siteIndex, site, yardIndex, yard });
    }
  }
  return targets;
}

export function streamCrushMvcInventory<E, R>(options: {
  onBatch: (listings: RawCrushListing[]) => Effect.Effect<void, E, R>;
  sites?: readonly CrushMvcSiteConfig[];
  startPageIndex?: number;
  maxPages?: number;
}): Effect.Effect<CrushMvcStreamResult, CrushMvcProviderError | E, R> {
  const sites = options.sites ?? CRUSH_MVC_SITES;

  return Effect.gen(function* () {
    let pagesProcessed = 0;
    let listingsProcessed = 0;
    const startPageIndex = Math.max(0, options.startPageIndex ?? 0);
    const maxPages = Math.max(1, options.maxPages ?? Number.MAX_SAFE_INTEGER);
    const targets = flattenPageTargets(sites);
    let nextPageIndex = startPageIndex;
    const errors: string[] = [];
    const seen = new Set<string>();

    yield* Effect.logInfo(
      `[CRUSH MVC] Streaming inventory across ${targets.length} pages`,
    );

    for (
      let pageIndex = startPageIndex;
      pageIndex < targets.length && pagesProcessed < maxPages;
      pageIndex += 1
    ) {
      const target = targets[pageIndex];
      if (!target) break;
      nextPageIndex = pageIndex;

      const sourceUrl = new URL(
        target.site.inventoryPath,
        target.site.baseUrl,
      ).toString();

      const html = yield* fetchInventoryPage(target.site, {
        yard: target.yard,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new CrushMvcProviderError({
              cursor: `${target.site.siteId}:${target.yard.name}`,
              cause,
            }),
        ),
      );

      const parsed = parseCrushInventoryHtml(html, {
        sourceUrl,
        yardId: target.yard.yardId,
        yardName: target.yard.name,
      });

      const batch: RawCrushListing[] = [];
      for (const listing of parsed) {
        const key = listingKey(listing);
        if (seen.has(key)) continue;
        seen.add(key);
        batch.push(listing);
      }
      if (batch.length > 0) {
        yield* options.onBatch(batch);
      }

      listingsProcessed += batch.length;
      pagesProcessed += 1;
      nextPageIndex = pageIndex + 1;

      yield* Effect.logInfo(
        `[CRUSH MVC] ${target.site.siteId}/${target.yard.name}: ${batch.length} listings`,
      );
    }

    const complete = nextPageIndex >= targets.length;

    return {
      source: "crush-mvc" as const,
      status: complete ? ("complete" as const) : ("paused" as const),
      cursor: nextPageIndex,
      count: listingsProcessed,
      errors,
      pagesProcessed,
    };
  });
}

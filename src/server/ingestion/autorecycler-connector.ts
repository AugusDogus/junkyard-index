import { autorecyclerYard, type OnYards } from "./yard-metadata";
import { Effect } from "effect";
import {
  buildInventoryMsearchBody,
  postAutorecyclerElasticsearchMsearch,
  type AutorecyclerMsearchHit,
} from "./autorecycler-client";
import {
  AutorecyclerCursor,
  AutorecyclerCursorSchema,
} from "./autorecycler-cursor";
import {
  AUTORECYCLER_PAGE_SIZE,
  AutorecyclerInventoryPage,
} from "./autorecycler-inventory-page";
import type { ConnectorChunkResult } from "./connector-chunk";
import { createAutorecyclerOrgGeoResolver } from "./autorecycler-geo";
import { fetchAutorecyclerYardWebsites } from "./autorecycler-website";
import { AutorecyclerSourcePolicy } from "./autorecycler-source-policy";
import {
  parseAutorecyclerNameText,
  transformAutorecyclerMsearchHit,
} from "./autorecycler-transform";
import { inventoryVin } from "./inventory-vin";
import type { CanonicalVehicle } from "./types";
import { AutorecyclerProviderError } from "./errors";
import type { PersistenceError } from "./errors";
import type { Database } from "./context";

function hitSource(
  hit: AutorecyclerMsearchHit,
): Record<string, unknown> | null {
  const src = hit._source;
  if (!src || typeof src !== "object") return null;
  return src;
}

/** Same normalization as {@link transformAutorecyclerMsearchHit} (trimmed org id). */
function autorecyclerOrgLookupKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

/** The public catalog also contains real listings without a VIN. They cannot
 * enter a VIN-keyed inventory; nonempty malformed VINs remain rejections. */
function isVinlessCatalogRecord(src: Record<string, unknown>): boolean {
  const reference = /^(?:\d+__LOOKUP__)?\d+x\d+$/;
  return (
    (src.vin_text === undefined ||
      src.vin_text === null ||
      (typeof src.vin_text === "string" && src.vin_text.trim() === "")) &&
    typeof src.inventory_id_text === "string" &&
    reference.test(src.inventory_id_text.trim()) &&
    typeof src.organization_custom_organization === "string" &&
    reference.test(src.organization_custom_organization.trim())
  );
}

export type AutorecyclerStreamResult = ConnectorChunkResult<
  "autorecycler",
  AutorecyclerCursor
> & {
  geoStats: ReturnType<
    ReturnType<typeof createAutorecyclerOrgGeoResolver>["getStats"]
  >;
};

interface AutorecyclerStreamOptions<E, R> {
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: OnYards;
  startCursor?: AutorecyclerCursor;
  maxPages?: number;
}

type AutorecyclerPageFetcher = (
  beforeId: string | null,
  pageSize: number,
) => Promise<unknown>;

/**
 * Stream AutoRecycler global inventory via encrypted `msearch`, resolve yard
 * coordinates via cached `init/data` on representative `details/{inventory_id}` rows.
 */
export function streamAutorecyclerInventoryWithPageFetcher<E, R>(
  options: AutorecyclerStreamOptions<E, R>,
  fetchPage: AutorecyclerPageFetcher,
  sourcePolicy: AutorecyclerSourcePolicy = AutorecyclerSourcePolicy.create(),
): Effect.Effect<
  AutorecyclerStreamResult,
  AutorecyclerProviderError | PersistenceError | E,
  Database | R
> {
  return Effect.gen(function* () {
    yield* Effect.logInfo("[AutoRecycler] Starting stream");

    const geo = createAutorecyclerOrgGeoResolver();
    const websites = new Map<string, string | null>();
    const parsedCursor = AutorecyclerCursorSchema.safeParse(
      options.startCursor ?? AutorecyclerCursor.initial,
    );
    if (!parsedCursor.success)
      return yield* new AutorecyclerProviderError({
        from: 0,
        cause: new Error(
          "Invalid record-ID cursor. Restart this source with a new ingestion run; previously published inventory is preserved.",
        ),
      });
    let cursor = parsedCursor.data;
    let pagesProcessed = 0;
    let totalCanonical = 0;
    const errors: string[] = [];
    const observedVins = new Set<string>();
    const seen = new Set<string>();
    const excludedYards = new Map<string, number>();
    let recordsProcessed = 0;
    let recordsExcluded = 0;
    let recordsRejected = 0;
    let duplicateVehicles = 0;
    let mirroredRecords = 0;
    let vinlessRecords = 0;

    const maxPages = Math.max(1, options.maxPages ?? Number.MAX_SAFE_INTEGER);

    const processPage = (
      beforeId: string | null,
      json: unknown,
    ): Effect.Effect<
      string | null,
      AutorecyclerProviderError | PersistenceError | E,
      Database | R
    > =>
      Effect.gen(function* () {
        const parsed = AutorecyclerInventoryPage.parse(json, beforeId);
        if (!parsed.ok)
          return yield* new AutorecyclerProviderError({
            from: 0,
            cause: new Error(
              `Inventory search beforeId=${beforeId ?? "start"}: ${parsed.detail}. Reconciliation is blocked and previously published inventory is preserved. Inspect the provider response before retrying.`,
            ),
          });
        const { hits, lastId } = parsed;
        const organizations = new Set<string>();
        for (const hit of hits) {
          const src = hitSource(hit);
          if (!src || isVinlessCatalogRecord(src)) continue;
          const org = autorecyclerOrgLookupKey(
            src.organization_custom_organization,
          );
          if (org) organizations.add(org);
        }
        const decisions = yield* sourcePolicy([...organizations]);
        for (const org of organizations) {
          if (!decisions.has(org))
            return yield* new AutorecyclerProviderError({
              from: 0,
              cause: new Error(
                `Source ownership lookup omitted organization ${org}; no page inventory was emitted`,
              ),
            });
        }
        const seeds = new Map<string, string>();
        for (const h of hits) {
          const src = hitSource(h);
          if (!src || isVinlessCatalogRecord(src)) continue;
          const orgKey = autorecyclerOrgLookupKey(
            src.organization_custom_organization,
          );
          const invKey = autorecyclerOrgLookupKey(src.inventory_id_text);
          if (orgKey && invKey && decisions.get(orgKey) === "independent") {
            if (!geo.getCached(orgKey) && !seeds.has(orgKey)) {
              seeds.set(orgKey, invKey);
            }
          }
        }

        yield* geo.resolveBatchEffect(seeds);

        if (options.onYards) {
          const missingWebsites = [...seeds.keys()].filter(
            (key) =>
              geo.getCached(key)?.status === "resolved" && !websites.has(key),
          );
          if (missingWebsites.length > 0) {
            const resolved = yield* Effect.tryPromise({
              try: () => fetchAutorecyclerYardWebsites(missingWebsites),
              catch: (cause) =>
                new AutorecyclerProviderError({ from: 0, cause }),
            });
            for (const [key, url] of resolved) websites.set(key, url);
          }
        }

        const pageCanonical: CanonicalVehicle[] = [];
        const pageYards = new Map<
          string,
          ReturnType<typeof autorecyclerYard>
        >();
        recordsProcessed += hits.length;
        for (const h of hits) {
          const src = hitSource(h);
          if (!src) {
            recordsRejected += 1;
            continue;
          }
          if (isVinlessCatalogRecord(src)) {
            recordsExcluded++;
            vinlessRecords++;
            continue;
          }
          const orgKey = autorecyclerOrgLookupKey(
            src.organization_custom_organization,
          );
          if (orgKey && decisions.get(orgKey) === "direct-provider") {
            recordsExcluded++;
            mirroredRecords++;
            continue;
          }
          const identityYear =
            parseAutorecyclerNameText(src.name_text, src.vehicle_year_number)
              ?.year ?? src.vehicle_year_number;
          const identity =
            typeof src.vin_text === "string"
              ? inventoryVin(
                  src.vin_text,
                  typeof identityYear === "number" &&
                    Number.isFinite(identityYear)
                    ? String(identityYear)
                    : "",
                )
              : null;
          if (!identity) {
            recordsRejected++;
            continue;
          }
          const resolution = orgKey ? geo.getCached(orgKey) : undefined;
          if (
            orgKey &&
            (decisions.get(orgKey) === "unresolved" ||
              resolution?.status === "unresolved")
          ) {
            recordsExcluded += 1;
            observedVins.add(identity);
            excludedYards.set(orgKey, (excludedYards.get(orgKey) ?? 0) + 1);
            continue;
          }
          if (resolution?.status !== "resolved" || !orgKey) {
            recordsRejected += 1;
            observedVins.add(identity);
            continue;
          }
          const g = resolution.geo;
          pageYards.set(
            orgKey,
            autorecyclerYard(g, websites.get(orgKey) ?? null),
          );
          const c = transformAutorecyclerMsearchHit(src, g);
          if (!c) {
            recordsRejected += 1;
            observedVins.add(identity);
          } else if (seen.has(identity)) {
            duplicateVehicles += 1;
          } else {
            seen.add(identity);
            pageCanonical.push({ ...c, vin: identity });
          }
        }

        if (options.onYards) yield* options.onYards([...pageYards.values()]);
        if (pageCanonical.length > 0) {
          yield* options.onBatch(pageCanonical);
        }

        totalCanonical += pageCanonical.length;
        pagesProcessed += 1;
        return lastId;
      });

    while (cursor.phase === "page" && pagesProcessed < maxPages) {
      const beforeId = cursor.beforeId;
      const json = yield* Effect.tryPromise({
        try: () => fetchPage(beforeId, AUTORECYCLER_PAGE_SIZE),
        catch: (cause) =>
          new AutorecyclerProviderError({
            from: 0,
            cause: new Error(
              `Inventory search beforeId=${beforeId ?? "start"} failed; previously published inventory is preserved`,
              { cause },
            ),
          }),
      });
      const lastId = yield* processPage(beforeId, json);
      // at_end can describe a capped query, not the provider feed. A fresh
      // query after the final unique ID must be empty before we can reconcile.
      cursor =
        lastId === null
          ? { source: "autorecycler", phase: "complete" }
          : { source: "autorecycler", phase: "page", beforeId: lastId };
    }
    const done = cursor.phase === "complete";

    const warnings = [...excludedYards].map(
      ([orgLookup, count]) =>
        `AutoRecycler yard ${orgLookup}: skipped ${count} rows because its owned address and city could not be resolved. Observed VINs are preserved; cached geography is unchanged and known yards continue. Verify this organization's own metadata; resolution will be retried next chunk/run.`,
    );
    if (mirroredRecords > 0)
      yield* Effect.logInfo(
        `[AutoRecycler] Excluded ${mirroredRecords} Pull-A-Part/U-Pull-&-Pay mirror rows; the direct provider owns their inventory and VIN presence`,
      );
    if (vinlessRecords > 0)
      warnings.push(
        `AutoRecycler: excluded ${vinlessRecords} catalog entries without VINs. These entries cannot identify vehicles in the VIN-keyed catalog and do not preserve availability.`,
      );
    if (recordsRejected > 0)
      warnings.push(
        `AutoRecycler: rejected ${recordsRejected} rows with invalid vehicle metadata. Usable observed VINs preserve prior inventory; inspect the source rows.`,
      );
    for (const warning of warnings) yield* Effect.logWarning(warning);
    yield* Effect.logInfo(
      `[AutoRecycler] ${done ? "Completed" : "Paused"} pages=${pagesProcessed} vehicles=${totalCanonical} geo=${JSON.stringify(geo.getStats())}`,
    );

    return {
      source: "autorecycler" as const,
      status: done ? "complete" : "paused",
      cursor,
      count: totalCanonical,
      errors,
      pagesProcessed,
      geoStats: geo.getStats(),
      observedVins: [...observedVins],
      warnings,
      accounting: {
        recordsProcessed,
        recordsExcluded,
        recordsRejected,
        duplicateVehicles,
      },
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
  return streamAutorecyclerInventoryWithPageFetcher(
    options,
    (beforeId, pageSize) =>
      postAutorecyclerElasticsearchMsearch(
        buildInventoryMsearchBody(beforeId, pageSize),
      ),
  );
}

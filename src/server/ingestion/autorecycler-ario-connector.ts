import { SourceValidationPolicy } from "./source-validation";
import { selectAutorecyclerFeed } from "./autorecycler-freshness";
import { Effect } from "effect";
import {
  ArioYardsSchema,
  createArioClient,
  type ArioClient,
  ARIO_ORIGIN,
} from "./autorecycler-ario-client";
import {
  arioDate,
  arioGeo,
  readArioYard,
  transformArioItem,
} from "./autorecycler-ario-inventory";
import { ARIO_CUSTOMER_YARDS } from "./autorecycler-ario-yards";
import type { AutorecyclerCursor } from "./autorecycler-cursor";
import { AutorecyclerProviderError } from "./errors";
import { autorecyclerYard, type OnYards } from "./yard-metadata";
import type { CanonicalVehicle } from "./types";
import type { ConnectorChunkResult } from "./connector-chunk";

export function streamArioYard<E, R>(
  options: {
    yardIndex: number;
    asOf?: number;
    legacyNewest?: number | null;
    onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
    onYards?: OnYards;
  },
  client: ArioClient = createArioClient(),
) {
  return Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: async () => {
        const config = ARIO_CUSTOMER_YARDS[options.yardIndex];
        if (!config)
          throw new Error(`Unknown Ario customer index ${options.yardIndex}`);
        const directory = ArioYardsSchema.parse(await client.yards());
        const matches = directory.filter((yard) => yard.slug === config.slug);
        const yard = matches[0];
        if (
          matches.length !== 1 ||
          !yard ||
          !yard.display_name ||
          yard.id !== config.id ||
          yard.organization_id !== config.organizationId
        )
          throw new Error(
            `Ario customer ${config.slug} is missing or changed ownership. Inspect the public directory; published inventory is preserved.`,
          );
        const location =
          "locationOverride" in config ? config.locationOverride : null;
        const lat =
          location?.lat ?? yard.data.latitude ?? yard.data.mapCenter?.[1];
        const lng =
          location?.lng ?? yard.data.longitude ?? yard.data.mapCenter?.[0];
        if (lat === undefined || lng === undefined || (lat === 0 && lng === 0))
          throw new Error(
            `Ario customer ${config.slug} has no valid yard coordinates`,
          );
        const geo = arioGeo(
          config,
          yard.display_name,
          lat,
          lng,
          location?.address ?? yard.address,
        );
        const inventory = await readArioYard(client, config);
        const activeItems = inventory.items.filter(
          (item) => !item.ario_date_removed,
        );
        if (
          activeItems.length > 0 &&
          !activeItems.some((item) => arioDate(item) !== null)
        )
          throw new Error(
            `Ario ${config.slug} has ${activeItems.length} listings but no parseable addition dates. Expected date_placed or ario_date_placed in YYYY-MM-DD format. Published inventory is preserved; inspect the provider date contract before starting a new run.`,
          );
        const vehicles: CanonicalVehicle[] = [];
        const seen = new Set<string>();
        let rejected = 0;
        let duplicates = 0;
        let excluded = inventory.total - inventory.items.length;
        for (const item of inventory.items) {
          if (item.ario_date_removed) {
            excluded++;
            continue;
          }
          const vehicle = transformArioItem(item, geo);
          if (!vehicle) {
            rejected++;
            continue;
          }
          if (seen.has(vehicle.vin)) {
            duplicates++;
            continue;
          }
          seen.add(vehicle.vin);
          vehicles.push(vehicle);
        }
        const selection = selectAutorecyclerFeed(
          vehicles.map((vehicle) => Date.parse(vehicle.availableDate ?? "")),
          options.legacyNewest ?? null,
          options.asOf ?? Date.now(),
        );
        const observed = vehicles.length + rejected + duplicates;
        const quarantined =
          selection === "ario" &&
          (rejected > observed * SourceValidationPolicy.maximumRejectionRatio ||
            duplicates >
              observed * SourceValidationPolicy.maximumDuplicateRatio);
        const accepted = selection === "ario" && !quarantined;
        const published = accepted ? vehicles : [];
        return {
          selection: quarantined ? ("quarantined" as const) : selection,
          warnings: quarantined
            ? [
                `Ario ${config.slug} exceeds the 10% rejection or 25% duplicate yard guard (${rejected} rejected, ${duplicates} duplicates of ${observed}). This yard is quarantined; its prior inventory is preserved. Other yards can publish. Inspect the saved catalog before the next daily run.`,
              ]
            : [],
          vehicles: published,
          geo,
          pages: inventory.pages,
          rejected: accepted ? rejected : 0,
          duplicates: accepted ? duplicates : 0,
          excluded: accepted ? excluded : inventory.total,
          total: inventory.total,
          website: `${ARIO_ORIGIN}/yard/${config.slug}`,
        };
      },
      catch: (cause) =>
        new AutorecyclerProviderError({ from: options.yardIndex, cause }),
    });
    if (options.onYards && result.selection === "ario")
      yield* options.onYards([autorecyclerYard(result.geo, result.website)]);
    if (result.vehicles.length) yield* options.onBatch(result.vehicles);
    const next = options.yardIndex + 1;
    const cursor: AutorecyclerCursor =
      next < ARIO_CUSTOMER_YARDS.length
        ? { source: "autorecycler", phase: "ario", yardIndex: next }
        : { source: "autorecycler", phase: "page", beforeId: null };
    return {
      selection: result.selection,
      source: "autorecycler",
      status: "paused",
      cursor,
      count: result.vehicles.length,
      errors: [],
      warnings: result.warnings,
      pagesProcessed: result.pages,
      accounting: {
        recordsProcessed: result.total,
        recordsExcluded: result.excluded,
        recordsRejected: result.rejected,
        duplicateVehicles: result.duplicates,
      },
    } satisfies ConnectorChunkResult<"autorecycler", AutorecyclerCursor> & {
      selection: "ario" | "legacy" | "stale" | "quarantined";
    };
  });
}

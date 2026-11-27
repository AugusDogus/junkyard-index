import { Data, Effect, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import { ProviderNotReadyDeferred } from "./provider-chunk-clock";
import {
  fetchIPullUPullCatalog,
  type IPullUPullRateLimited,
} from "./ipullupull-client";
import {
  fetchIPullUPullMedia,
  ipullUPullMediaKey,
  ipullUPullPriorImageKey,
} from "./ipullupull-media";
import {
  ipullUPullVin,
  isUsableIPullUPullRecord,
  transformIPullUPullVehicle,
  type IPullUPullCanonicalVehicle,
} from "./ipullupull-transform";
import {
  loadIPullUPullDirectory,
  loadIPullUPullYards,
  type IPullUPullYard,
} from "./ipullupull-yard-metadata";

/** One atomic CSV checkpoint. Never resume an offset into a changing export. */
export type IPullUPullCursor = 0 | 1;
export type IPullUPullStreamResult = ConnectorChunkResult<
  "ipullupull",
  IPullUPullCursor
>;
export const IPULLUPULL_BATCH_SIZE = 250;
/** One request per two seconds. Runs at one per second drew HTTP 429 from the
 * WP Engine origin after 35 to 44 media pages (production 2026-11-20 and
 * 2026-11-27); a full run of about 51 requests takes about two minutes. */
export const IPULLUPULL_REQUEST_INTERVAL = "2 seconds";

export class IPullUPullStreamError extends Data.TaggedError(
  "IPullUPullStreamError",
)<{ message: string }> {}

export interface IPullUPullStreamOptions<E, R> {
  startCursor?: IPullUPullCursor;
  onBatch: (
    vehicles: IPullUPullCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: IPullUPullYard[]) => Effect.Effect<void, E, R>;
  /** Published image URLs by `ipullUPullPriorImageKey`, read only when a 429
   * cut the media sweep short. Absent, uncovered vehicles have no image. */
  loadPriorImages?: Effect.Effect<ReadonlyMap<string, string>, Error>;
}

/** Nothing was accepted: the run backs off and retries this cursor. */
function deferRateLimited(limit: IPullUPullRateLimited) {
  return new ProviderNotReadyDeferred({
    provider: "iPull-uPull",
    detail: `${limit.message}, so this run backs off instead of retrying into the rate limit.`,
    retryAfterMs: limit.retryAfterMs,
  });
}

export function streamIPullUPullInventoryWithRequestGate<E, R>(
  options: IPullUPullStreamOptions<E, R>,
  requestGate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const cursor = options.startCursor ?? 0;
    if (cursor !== 0 && cursor !== 1)
      return yield* new IPullUPullStreamError({
        message:
          "iPull-uPull cursor must be 0 (pending) or 1 (complete); restart with cursor 0.",
      });
    const result: IPullUPullStreamResult = {
      source: "ipullupull",
      status: "complete",
      cursor: 1,
      count: 0,
      errors: [],
      warnings: [],
      observedVins: [],
      pagesProcessed: 0,
      accounting: {
        recordsProcessed: 0,
        recordsExcluded: 0,
        recordsRejected: 0,
        duplicateVehicles: 0,
      },
    };
    if (cursor === 1) return result;
    const directory = yield* loadIPullUPullDirectory(requestGate).pipe(
      Effect.catchTag("IPullUPullRateLimited", (limit) =>
        Effect.fail(deferRateLimited(limit)),
      ),
    );
    const records = yield* fetchIPullUPullCatalog(requestGate).pipe(
      Effect.catchTag("IPullUPullRateLimited", (limit) =>
        Effect.fail(deferRateLimited(limit)),
      ),
    );
    const reported = new Set(
      records
        .filter(isUsableIPullUPullRecord)
        .map((record) => record["Yard City"].trim().toUpperCase()),
    );
    const missing = [...directory.keys()].filter((city) => !reported.has(city));
    if (missing.length > 0)
      return yield* new IPullUPullStreamError({
        message: `iPull-uPull export is missing usable records for currently listed yards ${missing.join(", ")}; verify the unfiltered catalog before retrying. No batches were emitted.`,
      });

    const accounting = {
      recordsProcessed: records.length,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    const observedVins = new Set<string>();
    const warningCounts = new Map<string, number>();
    const warn = (reason: string) =>
      warningCounts.set(reason, (warningCounts.get(reason) ?? 0) + 1);
    const accepted = [];
    for (const record of records) {
      const vin = ipullUPullVin(record);
      const city = record["Yard City"].trim().toUpperCase();
      if (!directory.has(city)) {
        accounting.recordsExcluded++;
        warn(
          `unlisted or unidentified yard ${JSON.stringify(city)}; no availability preserved`,
        );
        continue;
      }
      const status = record.Status.trim();
      // Sold assets with unsold parts are not available cars. Do not preserve
      // their VINs as active observations, even when their row is 300.
      if (/^Sold(?: \(\d+ unsold parts?\))?$/.test(status)) {
        accounting.recordsExcluded++;
        warn("sold vehicles (remaining parts do not make the car available)");
        continue;
      }
      if (status !== "Available") {
        accounting.recordsExcluded++;
        if (vin) observedVins.add(vin);
        warn(
          `unknown status ${JSON.stringify(status)}; observed VINs preserved, inspect upstream status semantics`,
        );
        continue;
      }
      if (record["Vehicle Row"].trim() === "300") {
        accounting.recordsExcluded++;
        warn(
          "row 300 pre-pulled engines/transmissions only; whole vehicles are no longer available",
        );
        continue;
      }
      if (!isUsableIPullUPullRecord(record)) {
        accounting.recordsRejected++;
        if (vin) observedVins.add(vin);
        warn(
          "invalid VIN/year/make/model; usable observed VINs preserved, inspect vehicle metadata",
        );
        continue;
      }
      accepted.push(record);
    }
    const cities = new Set(
      accepted.map((record) => record["Yard City"].trim().toUpperCase()),
    );
    const metadata = yield* loadIPullUPullYards(
      cities,
      directory,
      requestGate,
    ).pipe(
      Effect.catchTag("IPullUPullRateLimited", (limit) =>
        Effect.fail(deferRateLimited(limit)),
      ),
    );
    const catalog = yield* fetchIPullUPullMedia(requestGate);
    if (catalog.status === "rate-limited" && catalog.pagesRead === 0)
      return yield* deferRateLimited(catalog.limit);
    const media = catalog.media;
    // After progress, a 429 publishes the CSV inventory now: vehicles past the
    // last complete page keep the image already published for their listing.
    const priorImages =
      catalog.status === "complete"
        ? new Map<string, string>()
        : yield* (
            options.loadPriorImages ?? Effect.succeed(new Map<string, string>())
          );
    const uncovered =
      catalog.status === "complete"
        ? null
        : `vehicles missing from the ${catalog.pagesRead} media pages read before media page ${catalog.page}${catalog.pages === null ? "" : ` of ${catalog.pages}`} answered HTTP 429 keep their published image, or none when new; the next run refreshes them`;
    const vehicles: IPullUPullCanonicalVehicle[] = [];
    const seen = new Set<string>();
    // Prefer the newest published yard timestamp, then stock number and city.
    // This is independent of provider response ordering across identical VINs.
    accepted.sort(
      (a, b) =>
        b["Yard Date"].localeCompare(a["Yard Date"]) ||
        a["Stock Number"].localeCompare(b["Stock Number"]) ||
        a["Yard City"].localeCompare(b["Yard City"]),
    );
    for (const record of accepted) {
      const city = record["Yard City"].trim().toUpperCase();
      const yard = metadata.yards.get(city);
      const vehicle = yard ? transformIPullUPullVehicle(record, yard) : null;
      if (!vehicle) {
        accounting.recordsExcluded++;
        const vin = ipullUPullVin(record);
        if (vin) observedVins.add(vin);
        warn(
          `unresolved yard ${city}; observed VINs preserved, verify the public directory and yard coordinates`,
        );
        continue;
      }
      if (seen.has(vehicle.vin)) {
        accounting.duplicateVehicles++;
        continue;
      }
      // Only the resolved winner needs media. Never borrow a duplicate stock's
      // photo, and keep unresolved-yard observations above out of deduplication.
      const photo = media.get(
        ipullUPullMediaKey(record["Stock Number"], record.Vin, city),
      );
      if (!photo && uncovered !== null) {
        seen.add(vehicle.vin);
        warn(uncovered);
        vehicles.push({
          ...vehicle,
          imageUrl:
            priorImages.get(
              ipullUPullPriorImageKey(record["Stock Number"], vehicle.vin),
            ) ?? null,
        });
        continue;
      }
      if (!photo)
        return yield* new IPullUPullStreamError({
          message: `iPull-uPull media is missing CSV vehicle ${record["Stock Number"]} / ${record.Vin} / ${city}; the catalogs may have changed between requests. No batches were emitted and prior images are preserved. Retry from cursor 0.`,
        });
      seen.add(vehicle.vin);
      if (!photo.imageUrl)
        warn(
          "vehicles explicitly have no upstream asset photos; part images are not substituted",
        );
      vehicles.push({ ...vehicle, imageUrl: photo.imageUrl });
    }
    if (options.onYards) yield* options.onYards([...metadata.yards.values()]);
    for (
      let offset = 0;
      offset < vehicles.length;
      offset += IPULLUPULL_BATCH_SIZE
    )
      yield* options.onBatch(
        vehicles.slice(offset, offset + IPULLUPULL_BATCH_SIZE),
      );
    const warnings = [
      ...metadata.warnings,
      ...[...warningCounts].map(
        ([reason, count]) => `iPull-uPull: ${count} ${reason}.`,
      ),
    ];
    for (const warning of warnings) yield* Effect.logWarning(warning);
    return {
      ...result,
      count: vehicles.length,
      pagesProcessed: 1,
      accounting,
      warnings,
      observedVins: [...observedVins],
    };
  }).pipe(
    Effect.timeoutFail({
      duration: "5 minutes",
      onTimeout: () =>
        new IPullUPullStreamError({
          message:
            "iPull-uPull exceeded the five-minute atomic checkpoint budget; retry from cursor 0. No terminal checkpoint was returned.",
        }),
    }),
  );
}

export function streamIPullUPullInventory<E, R>(
  options: IPullUPullStreamOptions<E, R>,
) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: IPULLUPULL_REQUEST_INTERVAL }).pipe(
      Effect.flatMap((requestGate) =>
        streamIPullUPullInventoryWithRequestGate(options, requestGate),
      ),
    ),
  );
}

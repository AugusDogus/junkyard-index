import { Data, Effect, RateLimiter } from "effect";
import { fetchPullNSavePage, PullNSaveProviderError } from "./pullnsave-client";
import { PULLNSAVE_YARDS, resolvePullNSaveYard } from "./pullnsave-config";
import { pullnsaveYard, type OnYards } from "./yard-metadata";
import { transformPullNSaveVehicle } from "./pullnsave-transform";
import type { ProviderRequestGate } from "./provider-http-client";
import type { PullNSaveCanonicalVehicle } from "./pullnsave-transform";

const PROVIDER_PAGE_SIZE = 100;
export const PULLNSAVE_MAX_CATALOG_PAGES = 1_000;
// The provider sits behind a small IIS deployment; keep request volume polite.
export const PULLNSAVE_REQUEST_INTERVAL = "1500 millis";

export class PullNSaveStreamError extends Data.TaggedError(
  "PullNSaveStreamError",
)<{
  message: string;
}> {}

export interface PullNSaveStreamResult {
  source: "pullnsave";
  status: "paused" | "complete" | "failed";
  cursor: number;
  count: number;
  errors: string[];
  pagesProcessed: number;
}

interface PullNSaveStreamOptions<E, R> {
  onYards?: OnYards;
  onBatch: (vehicles: PullNSaveCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  startCursor?: number;
  maxPages?: number;
}

export function streamPullNSaveInventoryWithRequestGate<E, R>(
  options: PullNSaveStreamOptions<E, R>,
  requestGate: ProviderRequestGate,
): Effect.Effect<
  PullNSaveStreamResult,
  PullNSaveProviderError | PullNSaveStreamError | E,
  R
> {
  return Effect.gen(function* () {
    if (options.onYards)
      yield* options.onYards(PULLNSAVE_YARDS.map(pullnsaveYard));
    const seen = new Map<string, PullNSaveCanonicalVehicle>();
    let pagesProcessed = 0;
    let recordsProcessed = 0;
    let recordsSkipped = 0;
    const startPage = Math.max(1, options.startCursor ?? 1);
    const maxPages = Math.max(1, options.maxPages ?? Number.MAX_SAFE_INTEGER);
    let nextPage = startPage;
    let complete = false;

    while (!complete && pagesProcessed < maxPages) {
      if (nextPage > PULLNSAVE_MAX_CATALOG_PAGES) {
        return yield* new PullNSaveStreamError({
          message: `Pull-N-Save exceeded the maximum catalog size of ${PULLNSAVE_MAX_CATALOG_PAGES} pages`,
        });
      }

      // One page per iteration so ingestion stops immediately at the first
      // short page and request volume stays minimal.
      const records = yield* fetchPullNSavePage({
        pageNumber: nextPage,
        pageSize: PROVIDER_PAGE_SIZE,
        requestGate,
      }).pipe(
        Effect.mapError(
          (cause) => new PullNSaveProviderError({ page: nextPage, cause }),
        ),
      );

      if (records.length > PROVIDER_PAGE_SIZE) {
        return yield* new PullNSaveStreamError({
          message: `Pull-N-Save page ${nextPage} exceeded the expected ${PROVIDER_PAGE_SIZE}-record page size`,
        });
      }
      if (records.length === 0) {
        complete = true;
        pagesProcessed += 1;
        nextPage += 1;
        break;
      }
      recordsProcessed += records.length;

      const batch: PullNSaveCanonicalVehicle[] = [];
      for (const record of records) {
        const yard = resolvePullNSaveYard(record.astStoreNumber);
        if (!yard) {
          recordsSkipped += 1;
          continue;
        }
        const vehicle = transformPullNSaveVehicle(record, yard);
        if (!vehicle) {
          recordsSkipped += 1;
          continue;
        }
        if (seen.has(vehicle.vin)) continue;
        seen.set(vehicle.vin, vehicle);
        batch.push(vehicle);
      }
      if (batch.length > 0) yield* options.onBatch(batch);

      pagesProcessed += 1;
      nextPage += 1;

      if (records.length < PROVIDER_PAGE_SIZE) {
        complete = true;
        break;
      }
    }

    if (
      complete &&
      startPage === 1 &&
      recordsProcessed === 0 &&
      seen.size === 0 &&
      recordsSkipped === 0
    ) {
      return yield* new PullNSaveStreamError({
        message: "Pull-N-Save returned an empty inventory catalog",
      });
    }

    yield* Effect.logInfo(
      `[Pull-N-Save] Ingested ${seen.size} vehicles and skipped ${recordsSkipped} rows`,
    );

    return {
      source: "pullnsave" as const,
      status: complete ? "complete" : "paused",
      cursor: nextPage,
      count: seen.size,
      errors: [],
      pagesProcessed,
    };
  });
}

export function streamPullNSaveInventory<E, R>(
  options: PullNSaveStreamOptions<E, R>,
): Effect.Effect<
  PullNSaveStreamResult,
  PullNSaveProviderError | PullNSaveStreamError | E,
  R
> {
  return Effect.sleep(PULLNSAVE_REQUEST_INTERVAL).pipe(
    Effect.zipRight(
      Effect.scoped(
        RateLimiter.make({
          limit: 1,
          interval: PULLNSAVE_REQUEST_INTERVAL,
        }).pipe(
          Effect.flatMap((requestGate) =>
            streamPullNSaveInventoryWithRequestGate(options, requestGate),
          ),
        ),
      ),
    ),
  );
}

import { Data, Effect, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import { inventoryVin } from "./inventory-vin";
import type { ProviderRequestGate } from "./provider-http-client";
import { fetchUpullitwaPage, type UpullitwaPage } from "./upullitwa-client";
import { UpullitwaCursor, UpullitwaCursorSchema } from "./upullitwa-cursor";
import {
  transformUpullitwaVehicle,
  type UpullitwaCanonicalVehicle,
} from "./upullitwa-transform";
import {
  UPULLITWA_YARDS,
  upullitwaYard,
  type UpullitwaYard,
} from "./upullitwa-yard-metadata";

export { UpullitwaCursor, UpullitwaCursorSchema } from "./upullitwa-cursor";
export const UPULLITWA_REQUEST_INTERVAL = "1100 millis";
export type UpullitwaStreamResult = ConnectorChunkResult<
  "upullitwa",
  UpullitwaCursor
>;

export class UpullitwaStreamError extends Data.TaggedError(
  "UpullitwaStreamError",
)<{ message: string }> {}

interface UpullitwaStreamOptions<E, R> {
  onBatch: (vehicles: UpullitwaCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: UpullitwaYard[]) => Effect.Effect<void>;
  startCursor?: UpullitwaCursor;
  /** Native HTML pages, never sliced. Defaults to two pages per chunk. */
  maxPages?: number;
}

function validateDirectory(ids: readonly string[]) {
  const missing = UPULLITWA_YARDS.filter((yard) => !ids.includes(yard.code));
  return missing.length
    ? Effect.fail(
        new UpullitwaStreamError({
          message: `Washington U-Pull-It directory lost known yards ${missing.map((yard) => yard.code).join(", ")}; inspect the selector before reconciling`,
        }),
      )
    : Effect.void;
}

export function streamUpullitwaInventoryWithRequestGate<E, R>(
  options: UpullitwaStreamOptions<E, R>,
  requestGate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = UpullitwaCursorSchema.safeParse(
      options.startCursor ?? UpullitwaCursor.initial,
    );
    const maxPages = options.maxPages ?? 2;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 3200
    ) {
      return yield* new UpullitwaStreamError({
        message:
          "Invalid Washington U-Pull-It cursor or maxPages; use the source cursor schema and a chunk limit from 1 to 3200",
      });
    }
    let cursor: UpullitwaCursor = parsed.data;
    if (
      cursor.phase === "page" &&
      (cursor.pageFingerprints.length !== cursor.page - 1 ||
        new Set(cursor.pageFingerprints).size !==
          cursor.pageFingerprints.length ||
        new Set(cursor.completedYardIds).size !==
          cursor.completedYardIds.length ||
        cursor.completedYardIds.includes(cursor.yardId) ||
        (cursor.page === 1
          ? cursor.declaredPageCount !== 0 || cursor.usableYardVehicles !== 0
          : cursor.declaredPageCount < cursor.page))
    )
      return yield* new UpullitwaStreamError({
        message:
          "Inconsistent Washington U-Pull-It cursor; restart from the last valid checkpoint",
      });

    if (cursor.phase === "start") {
      const directory = yield* fetchUpullitwaPage("ANY", 1, requestGate);
      yield* validateDirectory(directory.yardIds);
      const first = directory.yardIds[0];
      if (!first)
        return yield* new UpullitwaStreamError({
          message: "Washington U-Pull-It returned no yards",
        });
      cursor = {
        source: "upullitwa",
        phase: "page",
        yardId: first,
        page: 1,
        declaredPageCount: 0,
        completedYardIds: [],
        pageFingerprints: [],
        usableYardVehicles: 0,
      };
    }
    // Run-wide deduplication and exact acceptance counts belong to snapshots.
    const seen = new Set<string>();
    const observedVins = new Set<string>();
    const excludedYards = new Map<string, number>();
    let count = 0;
    let pagesProcessed = 0;
    let recordsProcessed = 0;
    let recordsExcluded = 0;
    let recordsRejected = 0;
    let duplicateVehicles = 0;
    let nextUrl: string | undefined;
    while (cursor.phase === "page" && pagesProcessed < maxPages) {
      const page: UpullitwaPage = yield* fetchUpullitwaPage(
        cursor.yardId,
        cursor.page,
        requestGate,
        nextUrl,
      );
      yield* validateDirectory(page.yardIds);
      if (
        cursor.completedYardIds.some((id) => !page.yardIds.includes(id)) ||
        (cursor.declaredPageCount !== 0 &&
          cursor.declaredPageCount !== page.lastPage) ||
        cursor.pageFingerprints.includes(page.fingerprint)
      ) {
        return yield* new UpullitwaStreamError({
          message: `Washington U-Pull-It yard ${cursor.yardId} page ${cursor.page}: directory/pagination changed or a page repeated. No checkpoint returned; retry from a fresh inventory run`,
        });
      }
      const yard = upullitwaYard(cursor.yardId);
      const batch: UpullitwaCanonicalVehicle[] = [];
      let usableYardVehicles: number = cursor.usableYardVehicles;
      recordsProcessed += page.records.length;
      for (const record of page.records) {
        if (!yard) {
          recordsExcluded += 1;
          const vin = inventoryVin(record.vin, record.year);
          if (vin) observedVins.add(vin);
          excludedYards.set(
            cursor.yardId,
            (excludedYards.get(cursor.yardId) ?? 0) + 1,
          );
          continue;
        }
        const vehicle = transformUpullitwaVehicle(record, yard);
        if (!vehicle) {
          recordsRejected += 1;
          const vin = inventoryVin(record.vin, record.year);
          if (vin) observedVins.add(vin);
          continue;
        }
        usableYardVehicles += 1;
        if (seen.has(vehicle.vin)) {
          duplicateVehicles += 1;
          continue;
        }
        seen.add(vehicle.vin);
        batch.push(vehicle);
      }
      if (!page.nextUrl && yard && usableYardVehicles === 0)
        return yield* new UpullitwaStreamError({
          message: `Washington U-Pull-It yard ${yard.code} returned no usable vehicles; inspect its inventory before reconciling`,
        });
      if (yard && options.onYards) yield* options.onYards([yard]);
      if (batch.length) yield* options.onBatch(batch);
      count += batch.length;
      pagesProcessed += 1;
      // Advance only after callbacks succeed. Fingerprints detect repeated pages
      // across resumed chunks without carrying inventory in the cursor.
      if (page.nextUrl) {
        cursor = {
          ...cursor,
          page: cursor.page + 1,
          declaredPageCount: page.lastPage,
          pageFingerprints: [...cursor.pageFingerprints, page.fingerprint],
          usableYardVehicles,
        };
        nextUrl = page.nextUrl;
      } else {
        const completedYardIds: string[] = [
          ...cursor.completedYardIds,
          cursor.yardId,
        ];
        const nextYard = page.yardIds.find(
          (id) => !completedYardIds.includes(id),
        );
        cursor = nextYard
          ? {
              source: "upullitwa",
              phase: "page",
              yardId: nextYard,
              page: 1,
              declaredPageCount: 0,
              completedYardIds,
              pageFingerprints: [],
              usableYardVehicles: 0,
            }
          : { source: "upullitwa", phase: "complete" };
        nextUrl = undefined;
      }
    }
    const warnings = [...excludedYards].map(
      ([id, excluded]) =>
        `Washington U-Pull-It yard ${id}: excluded ${excluded} rows because verified yard metadata/coordinates are unavailable. Observed VINs are preserved; known yards continue. Verify the public location before adding metadata.`,
    );
    if (recordsRejected > 0)
      warnings.push(
        `Washington U-Pull-It: rejected ${recordsRejected} rows with invalid vehicle metadata. Usable observed VINs preserve prior inventory; inspect the source rows.`,
      );
    for (const warning of warnings) yield* Effect.logWarning(warning);
    return {
      source: "upullitwa",
      status: cursor.phase === "complete" ? "complete" : "paused",
      cursor,
      count,
      pagesProcessed,
      errors: [],
      warnings,
      observedVins: [...observedVins],
      accounting: {
        recordsProcessed,
        recordsExcluded,
        recordsRejected,
        duplicateVehicles,
      },
    } satisfies UpullitwaStreamResult;
  });
}

export function streamUpullitwaInventory<E, R>(
  options: UpullitwaStreamOptions<E, R>,
) {
  return Effect.sleep(UPULLITWA_REQUEST_INTERVAL).pipe(
    Effect.zipRight(
      Effect.scoped(
        RateLimiter.make({
          limit: 1,
          interval: UPULLITWA_REQUEST_INTERVAL,
        }).pipe(
          Effect.flatMap((requestGate) =>
            streamUpullitwaInventoryWithRequestGate(options, requestGate),
          ),
        ),
      ),
    ),
  );
}

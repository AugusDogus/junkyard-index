import { Data, Effect, RateLimiter } from "effect";
import { Yard } from "~/lib/yard";
import type { ConnectorChunkResult } from "./connector-chunk";
import { fetchPickNSaveDetail, fetchPickNSavePage } from "./picknsave-client";
import {
  PickNSaveCursor,
  PickNSaveCursorSchema,
  PICKNSAVE_PAGE_SIZE,
} from "./picknsave-cursor";
import { parsePickNSaveDetail, type PickNSaveRecord } from "./picknsave-parser";
import { PICKNSAVE_YARDS, type PickNSaveYard } from "./picknsave-yard-metadata";
import {
  transformPickNSaveVehicle,
  type PickNSaveCanonicalVehicle,
} from "./picknsave-transform";
import type { ProviderRequestGate } from "./provider-http-client";

export class PickNSaveStreamError extends Data.TaggedError(
  "PickNSaveStreamError",
)<{ message: string }> {}
interface PickNSaveOptions<E, R> {
  startCursor?: PickNSaveCursor;
  maxPages?: number;
  onBatch: (vehicles: PickNSaveCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: PickNSaveYard[]) => Effect.Effect<void, E, R>;
}
export type PickNSaveStreamResult = ConnectorChunkResult<
  "picknsave",
  PickNSaveCursor
>;

export function streamPickNSaveInventoryWithRequestGate<E, R>(
  options: PickNSaveOptions<E, R>,
  requestGate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = PickNSaveCursorSchema.safeParse(
      options.startCursor ?? PickNSaveCursor.initial,
    );
    const maxPages = options.maxPages ?? 2;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 400
    )
      return yield* new PickNSaveStreamError({
        message:
          "Invalid Pick-n-Save checkpoint or page budget; use the source cursor schema and 1-400 pages",
      });
    let cursor: PickNSaveCursor = parsed.data;
    if (
      cursor.phase === "page" &&
      (cursor.page > Math.ceil(cursor.totalProducts / PICKNSAVE_PAGE_SIZE) ||
        new Set(cursor.yardsSeen).size !== cursor.yardsSeen.length)
    )
      return yield* new PickNSaveStreamError({
        message:
          "Inconsistent Pick-n-Save page evidence; resume the last valid checkpoint",
      });
    const result: PickNSaveStreamResult = {
      source: "picknsave",
      status: "complete",
      cursor,
      count: 0,
      pagesProcessed: 0,
      errors: [],
      warnings: [],
      observedVins: [],
      accounting: {
        recordsProcessed: 0,
        recordsExcluded: 0,
        recordsRejected: 0,
        duplicateVehicles: 0,
      },
    };
    if (cursor.phase === "complete") return result;
    for (const yard of PICKNSAVE_YARDS) {
      if (
        !Yard.parse(yard).success ||
        yard.lat === null ||
        yard.lng === null ||
        !yard.address ||
        !yard.postalCode ||
        !yard.phone ||
        !yard.websiteUrl
      )
        return yield* new PickNSaveStreamError({
          message: `Pick-n-Save yard ${yard.code} lacks verified location/contact fields; restore its metadata before ingesting`,
        });
    }
    const accounting = {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    const seenVins = new Set<string>();
    const observedVins = new Set<string>();
    let count = 0;
    let pagesProcessed = 0;
    while (cursor.phase !== "complete" && pagesProcessed < maxPages) {
      const page: number = cursor.phase === "start" ? 1 : cursor.page;
      const catalog = yield* fetchPickNSavePage(page, requestGate);
      if (
        cursor.phase === "page" &&
        catalog.totalProducts !== cursor.totalProducts
      )
        return yield* new PickNSaveStreamError({
          message: `Pick-n-Save catalog changed from ${cursor.totalProducts} to ${catalog.totalProducts} products during traversal. Start a fresh run; this run cannot prove complete inventory`,
        });
      let lastProductId: number =
        cursor.phase === "start" ? 0 : cursor.lastProductId;
      // Strict IDs catch replayed/ignored pages, including across resumed chunks.
      for (const product of catalog.products) {
        if (product.id <= lastProductId)
          return yield* new PickNSaveStreamError({
            message: `Pick-n-Save page ${page} repeated or reordered product ${product.id} after ${lastProductId}; inspect its ordering before retrying`,
          });
        lastProductId = product.id;
      }
      const yardsSeen: Set<PickNSaveRecord["yardCode"]> = new Set(
        cursor.phase === "start" ? [] : cursor.yardsSeen,
      );
      const batch: PickNSaveCanonicalVehicle[] = [];
      for (const product of catalog.products) {
        const html = yield* fetchPickNSaveDetail(product, requestGate);
        const detail = yield* parsePickNSaveDetail(html, product);
        accounting.recordsProcessed++;
        if (detail.status === "unavailable") {
          accounting.recordsExcluded++;
          continue;
        }
        if (detail.status === "incomplete") {
          accounting.recordsRejected++;
          if (detail.vin) observedVins.add(detail.vin);
          continue;
        }
        const yard = PICKNSAVE_YARDS.find(
          (candidate) => candidate.code === detail.record.yardCode,
        );
        const vehicle = yard
          ? transformPickNSaveVehicle(detail.record, yard)
          : null;
        if (!vehicle)
          return yield* new PickNSaveStreamError({
            message: `Pick-n-Save vehicle ${product.id} has no complete verified yard metadata; no checkpoint returned`,
          });
        yardsSeen.add(detail.record.yardCode);
        if (seenVins.has(vehicle.vin)) {
          accounting.duplicateVehicles++;
          continue;
        }
        seenVins.add(vehicle.vin);
        batch.push(vehicle);
      }
      const terminal: boolean = page === catalog.totalPages;
      if (terminal && PICKNSAVE_YARDS.some((yard) => !yardsSeen.has(yard.code)))
        return yield* new PickNSaveStreamError({
          message:
            "Pick-n-Save traversal finished without complete vehicles at both verified yards; inspect the catalog before reconciling prior inventory",
        });
      if (options.onYards) yield* options.onYards([...PICKNSAVE_YARDS]);
      if (batch.length) yield* options.onBatch(batch);
      count += batch.length;
      pagesProcessed++;
      cursor = terminal
        ? { source: "picknsave", phase: "complete" }
        : {
            source: "picknsave",
            phase: "page",
            page: page + 1,
            totalProducts: catalog.totalProducts,
            lastProductId,
            yardsSeen: [...yardsSeen].sort(),
          };
    }
    const warnings = accounting.recordsRejected
      ? [
          `Pick-n-Save rejected ${accounting.recordsRejected} incomplete vehicles. Usable observed VINs preserve existing records; no incomplete listings were emitted.`,
        ]
      : [];
    for (const warning of warnings) yield* Effect.logWarning(warning);
    return {
      ...result,
      status: cursor.phase === "complete" ? "complete" : "paused",
      cursor,
      count,
      pagesProcessed,
      accounting,
      warnings,
      observedVins: [...observedVins],
    } satisfies PickNSaveStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "4 minutes",
      onTimeout: () =>
        new PickNSaveStreamError({
          message:
            "Pick-n-Save exceeded the four-minute checkpoint budget. Retry the same cursor; no terminal checkpoint was returned",
        }),
    }),
  );
}

export function streamPickNSaveInventory<E, R>(
  options: PickNSaveOptions<E, R>,
) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1100 millis" }).pipe(
      Effect.flatMap((requestGate) =>
        streamPickNSaveInventoryWithRequestGate(options, requestGate),
      ),
    ),
  );
}

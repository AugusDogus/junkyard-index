import { createHash } from "node:crypto";
import { Effect, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import {
  RivervalleyProviderError,
  fetchRivervalleyControl,
  fetchRivervalleyPage,
} from "./rivervalley-client";
import {
  RivervalleyCursor,
  RivervalleyCursorSchema,
  type RivervalleySeen,
} from "./rivervalley-cursor";
import {
  transformRivervalleyRecord,
  type RivervalleyCanonicalVehicle,
} from "./rivervalley-transform";
import {
  RIVERVALLEY_YARD,
  type RivervalleyYard,
} from "./rivervalley-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";
import type { TruckPartsCatalogPage } from "./truck-parts-catalog";

interface RivervalleyOptions<E, R> {
  startCursor?: RivervalleyCursor;
  maxPages?: number;
  onBatch: (
    vehicles: RivervalleyCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: RivervalleyYard[]) => Effect.Effect<void, E, R>;
}
export type RivervalleyStreamResult = ConnectorChunkResult<
  "rivervalley",
  RivervalleyCursor
>;
const failure = (operation: string, cause: unknown) =>
  new RivervalleyProviderError({ operation, cause });
const identity = (vehicle: RivervalleyCanonicalVehicle) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        vehicle.year,
        vehicle.make.toUpperCase(),
        vehicle.model.toUpperCase(),
      ]),
    )
    .digest("hex");

function completionFailure(
  progress: Pick<
    Extract<RivervalleyCursor, { phase: "pages" }>,
    "emitted" | "rejected" | "duplicates" | "processed"
  >,
): RivervalleyProviderError | null {
  if (
    progress.emitted === 0 ||
    progress.rejected / progress.processed >
      SourceValidationPolicy.maximumRejectionRatio
  )
    return failure(
      "yard quality",
      progress.rejected +
        " rejected of " +
        progress.processed +
        " donors exceeds the unchanged 10% rejection guard or leaves no complete donors",
    );
  if (
    progress.duplicates / progress.processed >
    SourceValidationPolicy.maximumDuplicateRatio
  )
    return failure(
      "yard quality",
      progress.duplicates +
        " duplicates of " +
        progress.processed +
        " donors exceeds the unchanged 25% duplicate guard",
    );
  return null;
}

export function streamRivervalleyInventoryWithRequestGate<E, R>(
  options: RivervalleyOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = RivervalleyCursorSchema.safeParse(
      options.startCursor ?? RivervalleyCursor.initial,
    );
    const maxPages = options.maxPages ?? 8;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 2 ||
      maxPages > 32
    )
      return yield* failure(
        "checkpoint",
        "Expected a validated River Valley cursor and a budget of 2-32 HTTP requests",
      );
    let cursor: RivervalleyCursor = parsed.data;
    let pagesProcessed = 0;
    let count = 0;
    const observedVins = new Set<string>();
    const accounting = {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    let pending: TruckPartsCatalogPage | null = null;
    if (cursor.phase === "start") {
      pending = yield* fetchRivervalleyPage(1, gate);
      pagesProcessed++;
      const control = pending.records.find(
        (record) => transformRivervalleyRecord(record).status === "available",
      );
      if (!control)
        return yield* failure(
          "active scope control",
          "The first native page has no independently valid donor identity to verify Now Wrecking",
        );
      yield* fetchRivervalleyControl(control, gate);
      pagesProcessed++;
    } else if (cursor.phase === "pages") {
      const boundary = yield* fetchRivervalleyPage(cursor.nextPage - 1, gate);
      pagesProcessed++;
      if (
        boundary.total !== cursor.total ||
        boundary.rangeEnd !== cursor.processed ||
        boundary.hash !== cursor.hashes.at(-1)
      )
        return yield* failure(
          "resume boundary",
          "The prior native page changed after its checkpoint; inspect the source and restart instead of skipping changed donors",
        );
    }
    while (
      cursor.phase !== "complete" &&
      (pending !== null || pagesProcessed < maxPages)
    ) {
      if (cursor.phase === "verify") {
        const page = yield* fetchRivervalleyPage(cursor.verifyPage, gate);
        pagesProcessed++;
        if (
          page.total !== cursor.total ||
          page.hash !== cursor.hashes[cursor.verifyPage - 1]
        )
          return yield* failure(
            "terminal prefix verification",
            "A previously processed native page changed; retain prior inventory and restart the crawl instead of accepting stale donors",
          );
        if (cursor.verifyPage === cursor.hashes.length) {
          const qualityFailure = completionFailure(cursor);
          if (qualityFailure) return yield* qualityFailure;
          if (options.onYards) yield* options.onYards([RIVERVALLEY_YARD]);
          cursor = { source: "rivervalley", phase: "complete" };
        } else cursor = { ...cursor, verifyPage: cursor.verifyPage + 1 };
        continue;
      }
      const pageNumber = cursor.phase === "start" ? 1 : cursor.nextPage;
      const page: TruckPartsCatalogPage =
        pending ?? (yield* fetchRivervalleyPage(pageNumber, gate));
      if (pending === null) pagesProcessed++;
      pending = null;
      const prior: Omit<
        Extract<RivervalleyCursor, { phase: "pages" }>,
        "source" | "phase" | "nextPage"
      > = cursor.phase === "pages"
        ? cursor
        : {
            total: page.total,
            processed: 0,
            emitted: 0,
            rejected: 0,
            duplicates: 0,
            seen: [],
            hashes: [],
          };
      if (
        page.total !== prior.total ||
        page.rangeStart !== prior.processed + 1 ||
        prior.hashes.includes(page.hash)
      )
        return yield* failure(
          "pagination",
          "Native total, sequential range or page identity changed during traversal",
        );
      const seen: RivervalleySeen[] = [...prior.seen];
      const ids = new Set(seen.map((row) => row.id));
      const accepted = new Map(
        seen.flatMap((row) =>
          row.status === "available" ? [[row.vin, row.identity] as const] : [],
        ),
      );
      const vehicles: RivervalleyCanonicalVehicle[] = [];
      let rejected = 0;
      let duplicates = 0;
      for (const record of page.records) {
        if (ids.has(record.id))
          return yield* failure(
            "native donor identity",
            "Native donor " +
              record.id +
              " repeats across distinct catalog pages",
          );
        ids.add(record.id);
        const result = transformRivervalleyRecord(record);
        if (result.status === "incomplete") {
          rejected++;
          seen.push({
            id: record.id,
            status: "incomplete",
            vin: result.vin,
            identity: null,
          });
          if (result.vin) observedVins.add(result.vin);
          continue;
        }
        const signature = identity(result.vehicle);
        const previous = accepted.get(result.vehicle.vin);
        if (previous !== undefined && previous !== signature)
          return yield* failure(
            "native VIN identity",
            "Different donor IDs reuse VIN " +
              result.vehicle.vin +
              " with conflicting year, make or model",
          );
        if (previous !== undefined) {
          duplicates++;
          seen.push({
            id: record.id,
            status: "duplicate",
            vin: result.vehicle.vin,
            identity: signature,
          });
        } else {
          accepted.set(result.vehicle.vin, signature);
          vehicles.push(result.vehicle);
          seen.push({
            id: record.id,
            status: "available",
            vin: result.vehicle.vin,
            identity: signature,
          });
        }
      }
      const processed = prior.processed + page.records.length;
      const totalRejected = prior.rejected + rejected;
      const totalDuplicates = prior.duplicates + duplicates;
      const emitted = prior.emitted + vehicles.length;
      const hashes = [...prior.hashes, page.hash];
      const terminal = page.page === page.lastPage;
      if (
        terminal &&
        (processed !== page.total ||
          seen.length !== page.total ||
          hashes.length !== page.lastPage)
      )
        return yield* failure(
          "terminal accounting",
          "Observed native donor IDs and page coverage do not equal the advertised Salvage total",
        );
      if (terminal) {
        const qualityFailure = completionFailure({
          emitted,
          processed,
          rejected: totalRejected,
          duplicates: totalDuplicates,
        });
        if (qualityFailure) return yield* qualityFailure;
      }
      const next = RivervalleyCursorSchema.safeParse({
        source: "rivervalley",
        ...(terminal
          ? { phase: "verify", verifyPage: 1 }
          : { phase: "pages", nextPage: page.page + 1 }),
        total: page.total,
        processed,
        emitted,
        rejected: totalRejected,
        duplicates: totalDuplicates,
        seen,
        hashes,
      });
      if (!next.success)
        return yield* failure("checkpoint evidence", next.error.message);
      // Callback failures return no advanced checkpoint.
      if (vehicles.length) yield* options.onBatch(vehicles);
      cursor = next.data;
      count += vehicles.length;
      accounting.recordsProcessed += page.records.length;
      accounting.recordsRejected += rejected;
      accounting.duplicateVehicles += duplicates;
    }
    return {
      source: "rivervalley",
      status: cursor.phase === "complete" ? "complete" : "paused",
      cursor,
      count,
      pagesProcessed,
      accounting,
      observedVins: [...observedVins],
      errors: [],
      warnings: accounting.recordsRejected
        ? [
            "River Valley rejected donors missing required identities; independently valid VINs supply presence evidence only.",
          ]
        : [],
    } satisfies RivervalleyStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        failure(
          "chunk budget",
          "Three-minute request budget exceeded; retry the last checkpoint",
        ),
    }),
  );
}

export function streamRivervalleyInventory<E, R>(
  options: RivervalleyOptions<E, R>,
) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamRivervalleyInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}

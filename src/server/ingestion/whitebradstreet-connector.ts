import { ingestionValidation } from "./ingestion-validation";
import { createHash } from "node:crypto";
import { Effect, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";
import type { TruckPartsCatalogPage } from "./truck-parts-catalog";
import {
  fetchWhitebradstreetControl,
  fetchWhitebradstreetPage,
  WhitebradstreetProviderError,
} from "./whitebradstreet-client";
import {
  WhitebradstreetCursor,
  WhitebradstreetCursorSchema,
  type WhitebradstreetSeen,
} from "./whitebradstreet-cursor";
import {
  transformWhitebradstreetRecord,
  type WhitebradstreetCanonicalVehicle,
} from "./whitebradstreet-transform";
import {
  WHITEBRADSTREET_YARD,
  type WhitebradstreetYard,
} from "./whitebradstreet-yard-metadata";

interface WhitebradstreetOptions<E, R> {
  startCursor?: WhitebradstreetCursor;
  maxPages?: number;
  onBatch: (
    vehicles: WhitebradstreetCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: WhitebradstreetYard[]) => Effect.Effect<void, E, R>;
}
export type WhitebradstreetStreamResult = ConnectorChunkResult<
  "whitebradstreet",
  WhitebradstreetCursor
>;
interface Progress {
  total: number;
  processed: number;
  emitted: number;
  rejected: number;
  duplicates: number;
  seen: WhitebradstreetSeen[];
  hashes: string[];
}
const fresh = (): Progress => ({
  total: 0,
  processed: 0,
  emitted: 0,
  rejected: 0,
  duplicates: 0,
  seen: [],
  hashes: [],
});
const failure = (operation: string, cause: unknown) =>
  Effect.fail(new WhitebradstreetProviderError({ operation, cause }));

/** The ledger covers all native rows, including rejected presence-only donors. */
function append(
  progress: Progress,
  page: TruckPartsCatalogPage,
): WhitebradstreetCanonicalVehicle[] {
  if (
    page.page !== progress.hashes.length + 1 ||
    (progress.total !== 0 && page.total !== progress.total)
  )
    throw new Error(
      "Native page order or advertised total changed during traversal",
    );
  progress.total = page.total;
  const ids = new Set(progress.seen.map((row) => row.id));
  const identities = new Map(
    progress.seen.flatMap((row) =>
      row.status === "available" ? [[row.vin, row.identity] as const] : [],
    ),
  );
  const vehicles: WhitebradstreetCanonicalVehicle[] = [];
  for (const record of page.records) {
    if (ids.has(record.id))
      throw new Error(
        "Native donor " +
          record.id +
          " repeated across pages; inventory moved during traversal",
      );
    ids.add(record.id);
    const result = transformWhitebradstreetRecord(record);
    if (result.status === "incomplete") {
      progress.seen.push({
        id: record.id,
        status: "incomplete",
        vin: result.vin,
        identity: null,
      });
      progress.rejected++;
    } else {
      const vehicle = result.vehicle;
      const identity = createHash("sha256")
        .update(
          JSON.stringify([
            vehicle.year,
            vehicle.make.toUpperCase(),
            vehicle.model.toUpperCase(),
          ]),
        )
        .digest("hex");
      const prior = identities.get(vehicle.vin);
      if (prior !== undefined && prior !== identity)
        throw new Error(
          "Canonical VIN " +
            vehicle.vin +
            " has conflicting native year, make or model",
        );
      if (prior !== undefined) {
        progress.seen.push({
          id: record.id,
          status: "duplicate",
          vin: vehicle.vin,
          identity,
        });
        progress.duplicates++;
      } else {
        identities.set(vehicle.vin, identity);
        progress.seen.push({
          id: record.id,
          status: "available",
          vin: vehicle.vin,
          identity,
        });
        progress.emitted++;
        vehicles.push(vehicle);
      }
    }
    progress.processed++;
  }
  progress.hashes.push(page.hash);
  // The fixed native total lets us reject irrecoverable cumulative quality
  // failures even before the terminal page. Chunk boundaries cannot reset it.
  if (
    progress.rejected / progress.total >
    SourceValidationPolicy.maximumRejectionRatio
  )
    throw new Error(
      "Cumulative required-field rejects exceed the unchanged 10% rejection limit",
    );
  if (
    progress.duplicates / progress.total >
    SourceValidationPolicy.maximumDuplicateRatio
  )
    throw new Error(
      "Cumulative canonical duplicates exceed the unchanged 25% duplicate limit",
    );
  return vehicles;
}

export function streamWhitebradstreetInventoryWithRequestGate<E, R>(
  options: WhitebradstreetOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = WhitebradstreetCursorSchema.safeParse(
      options.startCursor ?? WhitebradstreetCursor.initial,
    );
    const maxPages = options.maxPages ?? 8;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* failure(
        "checkpoint",
        "Use a validated White & Bradstreet cursor and a budget of 1-32 new catalog pages",
      );
    const cursor = parsed.data;
    const empty: WhitebradstreetStreamResult = {
      source: "whitebradstreet",
      status: "complete",
      cursor: { source: "whitebradstreet", phase: "complete" },
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
    if (cursor.phase === "complete") return empty;
    const progress = fresh();
    let controlValidated = false;
    const consume = (page: TruckPartsCatalogPage) =>
      ingestionValidation({
        try: () => append(progress, page),
        catch: (cause) =>
          new WhitebradstreetProviderError({
            operation: "page " + page.page + " accounting",
            cause,
          }),
      });
    const control = (page: TruckPartsCatalogPage) =>
      Effect.gen(function* () {
        if (controlValidated) return;
        const record = page.records.find(
          (row) => transformWhitebradstreetRecord(row).status === "available",
        );
        if (!record)
          return yield* failure(
            "active donor control",
            "First native page has no complete donor for a source-linked Now Wrecking detail control",
          );
        yield* fetchWhitebradstreetControl(record, gate);
        controlValidated = true;
      });
    // Replay the complete accepted prefix before emitting resumed work. This
    // ties the persisted ledger and its counters to current native evidence.
    if (cursor.phase === "pages") {
      for (let pageNumber = 1; pageNumber < cursor.nextPage; pageNumber++) {
        const page = yield* fetchWhitebradstreetPage(pageNumber, gate);
        if (
          page.total !== cursor.total ||
          page.hash !== cursor.hashes[pageNumber - 1]
        )
          return yield* failure(
            "resume page " + pageNumber,
            "Native catalog changed since the checkpoint; restart from the initial cursor",
          );
        yield* control(page);
        yield* consume(page);
      }
      if (
        JSON.stringify(progress) !==
        JSON.stringify({
          total: cursor.total,
          processed: cursor.processed,
          emitted: cursor.emitted,
          rejected: cursor.rejected,
          duplicates: cursor.duplicates,
          seen: cursor.seen,
          hashes: cursor.hashes,
        })
      )
        return yield* failure(
          "checkpoint evidence",
          "Persisted donor identities or counters do not match the native prefix; restart from the initial cursor",
        );
    }
    const before = {
      processed: progress.processed,
      rejected: progress.rejected,
      duplicates: progress.duplicates,
    };
    const vehicles: WhitebradstreetCanonicalVehicle[] = [];
    const seenStart = progress.seen.length;
    let pagesProcessed = 0;
    let terminal = false;
    while (pagesProcessed < maxPages && !terminal) {
      const page = yield* fetchWhitebradstreetPage(
        progress.hashes.length + 1,
        gate,
      );
      yield* control(page);
      vehicles.push(...(yield* consume(page)));
      pagesProcessed++;
      terminal = page.nextUrl === null;
    }
    if (terminal) {
      if (progress.processed !== progress.total || progress.emitted === 0)
        return yield* failure(
          "terminal catalog",
          "Native terminal row count differs from its advertised total or no complete donors remain",
        );
      // Recheck every page at completion so an in-flight reorder or optional
      // metadata change cannot silently qualify a mixed catalog snapshot.
      for (
        let pageNumber = 1;
        pageNumber <= progress.hashes.length;
        pageNumber++
      ) {
        const page = yield* fetchWhitebradstreetPage(pageNumber, gate);
        if (
          page.total !== progress.total ||
          page.hash !== progress.hashes[pageNumber - 1]
        )
          return yield* failure(
            "terminal page " + pageNumber,
            "Native catalog changed during enumeration; restart from the initial cursor",
          );
      }
    }
    const nextCursor: WhitebradstreetCursor = terminal
      ? { source: "whitebradstreet", phase: "complete" }
      : {
          source: "whitebradstreet",
          phase: "pages",
          nextPage: progress.hashes.length + 1,
          ...progress,
        };
    const validatedCursor = WhitebradstreetCursorSchema.safeParse(nextCursor);
    if (!validatedCursor.success)
      return yield* failure("checkpoint accounting", validatedCursor.error);
    if (terminal && options.onYards)
      yield* options.onYards([WHITEBRADSTREET_YARD]);
    if (vehicles.length > 0) yield* options.onBatch(vehicles);
    const rejected = progress.rejected - before.rejected;
    return {
      ...empty,
      status: terminal ? "complete" : "paused",
      cursor: validatedCursor.data,
      count: vehicles.length,
      pagesProcessed,
      observedVins: [
        ...new Set(
          progress.seen
            .slice(seenStart)
            .flatMap((row) =>
              row.status === "incomplete" && row.vin ? [row.vin] : [],
            ),
        ),
      ],
      warnings: rejected
        ? [
            "White & Bradstreet rejected " +
              rejected +
              " required-field-incomplete donors; valid native VINs supply presence evidence only.",
          ]
        : [],
      accounting: {
        recordsProcessed: progress.processed - before.processed,
        recordsExcluded: 0,
        recordsRejected: rejected,
        duplicateVehicles: progress.duplicates - before.duplicates,
      },
    } satisfies WhitebradstreetStreamResult;
  }).pipe(
    // A resumed 16-page crawl is about 33 paced reads (replay, new pages,
    // terminal recheck), plus room for two bounded HTTP 429 waits.
    Effect.timeoutFail({
      duration: "5 minutes",
      onTimeout: () =>
        new WhitebradstreetProviderError({
          operation: "crawl budget",
          cause:
            "Five-minute chunk limit exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}

export function streamWhitebradstreetInventory<E, R>(
  options: WhitebradstreetOptions<E, R>,
) {
  // Production reads 1.6 seconds apart drew Cloudflare HTTP 429 by page 5-9.
  // Sequential reads four seconds apart completed every live page.
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "4 seconds" }).pipe(
      Effect.flatMap((gate) =>
        streamWhitebradstreetInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}

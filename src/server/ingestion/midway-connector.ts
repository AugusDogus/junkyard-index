import { ingestionValidation } from "./ingestion-validation";
import { Clock, Effect, Option, RateLimiter } from "effect";
import {
  fetchMidwayCatalog,
  fetchMidwayHome,
  MidwayProviderError,
} from "./midway-client";
import { MidwayCursor, MidwayCursorSchema } from "./midway-cursor";
import { parseMidwayCatalog, type MidwayRecord } from "./midway-parser";
import {
  closeMidwayMakeCensus,
  fetchMidwayMakeRecords,
  midwayRecordDigest,
  openMidwayMakeCensus,
} from "./midway-catalog";
import {
  parseMidwayStockNumber,
  transformMidwayRecord,
  type MidwayCanonicalVehicle,
} from "./midway-transform";
import {
  MIDWAY_ORIGIN,
  MIDWAY_YARDS,
  parseMidwayYards,
  type MidwayYard,
  type MidwayYardCode,
} from "./midway-yard-metadata";
import type { ConnectorChunkResult } from "./connector-chunk";
import { inventoryVin } from "./inventory-vin";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";
import { ProviderChunkClock } from "./provider-chunk-clock";
import { sharedProviderHostTurn } from "./shared-provider-host";

interface MidwayOptions<E, R> {
  startCursor?: MidwayCursor;
  maxPages?: number;
  onBatch: (vehicles: MidwayCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: MidwayYard[]) => Effect.Effect<void, E, R>;
}
export type MidwayStreamResult = ConnectorChunkResult<"midway", MidwayCursor>;

/**
 * Start no new native request after this much of the five-minute chunk
 * limit. Midway shares the URG host slot, so one request can wait well beyond
 * its own latency; the remainder covers that wait plus the 25-second request.
 */
export const MIDWAY_CHUNK_SOFT_MS = 120_000;

/** Dedupe and transform one native page of donors against prior identities. */
function admitMidwayRecords(
  records: readonly MidwayRecord[],
  code: MidwayYardCode,
  previousVins: readonly string[],
  previousStocks: readonly string[],
) {
  const vins = new Set(previousVins);
  const stocks = new Set(previousStocks);
  const vehicles: MidwayCanonicalVehicle[] = [];
  const rejectedVins: string[] = [];
  let rejected = 0;
  for (const record of records) {
    const vin = inventoryVin(record.vin, record.year);
    const stock = parseMidwayStockNumber(record.stock);
    if (
      (vin !== null && vins.has(vin)) ||
      (stock !== null && stocks.has(stock))
    )
      throw new Error(
        "Duplicate native stock/VIN within or across selected Midway yards",
      );
    if (vin) vins.add(vin);
    if (stock) stocks.add(stock);
    const result = transformMidwayRecord(record, code);
    if (result.status === "available") vehicles.push(result.vehicle);
    else {
      rejected++;
      if (result.vin) rejectedVins.push(result.vin);
    }
  }
  return {
    vehicles,
    rejectedVins,
    rejected,
    vins: [...vins],
    stocks: [...stocks],
  };
}

function assertMidwayYardQuality(processed: number, rejected: number) {
  if (
    processed - rejected <= 0 ||
    rejected / processed > SourceValidationPolicy.maximumRejectionRatio
  )
    throw new Error(
      `${rejected} rejected of ${processed} donors exceeds the 10% rejection limit or leaves no accepted donor`,
    );
}

/**
 * One page unit validates and emits one complete selected physical yard.
 * Tulsa exceeds the native 500-row view, so its make traversal checkpoints
 * after every make page and completes only when the closing broad witness
 * proves the whole traversal, across however many chunks it takes.
 */
export function streamMidwayInventoryWithRequestGate<E, R>(
  options: MidwayOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = MidwayCursorSchema.safeParse(
      options.startCursor ?? MidwayCursor.initial,
    );
    const maxPages = options.maxPages ?? 2;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* new MidwayProviderError({
        operation: "checkpoint",
        cause: "Use a validated Midway cursor and 1-32 yard-page units",
      });
    let cursor: MidwayCursor = parsed.data;
    let count = 0;
    let pagesProcessed = 0;
    let nativePages = 0;
    const started = yield* Clock.currentTimeMillis;
    const observedVins: string[] = [];
    const accounting = {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    // The ownership check shares the chunk's first shared host turn with its
    // first native request, so a chunk advances with one turn; every later
    // request takes its own turn and a deferred one ends the chunk.
    const homeCheck = fetchMidwayHome(gate).pipe(
      Effect.flatMap((home) =>
        ingestionValidation({
          try: () => parseMidwayYards(home),
          catch: (cause) =>
            new MidwayProviderError({
              operation: "native yard identity",
              cause,
            }),
        }),
      ),
    );
    let homeChecked = false;
    const turn = <A, E2, R2>(request: Effect.Effect<A, E2, R2>) =>
      (homeChecked
        ? request.pipe(
            sharedProviderHostTurn(MIDWAY_ORIGIN + "/"),
            ProviderChunkClock.unlessDeferred(nativePages > 0),
          )
        : homeCheck.pipe(
            Effect.andThen(request),
            sharedProviderHostTurn(MIDWAY_ORIGIN + "/", 2),
            Effect.map(Option.some),
          )
      ).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            homeChecked = true;
          }),
        ),
      );
    while (cursor.phase !== "complete" && pagesProcessed < maxPages) {
      // Always make progress, then checkpoint before the hard chunk limit.
      if (
        nativePages > 0 &&
        (yield* Clock.currentTimeMillis) - started >= MIDWAY_CHUNK_SOFT_MS
      )
        break;
      if (cursor.phase === "yard" && cursor.yardCode !== "OO95") {
        const code = cursor.yardCode;
        const previousVins = cursor.observedVins;
        const previousStocks = cursor.stocks;
        const read = yield* turn(fetchMidwayCatalog(code, gate));
        if (Option.isNone(read)) break;
        const html = read.value;
        nativePages++;
        const snapshot = yield* ingestionValidation({
          try: () => {
            const records = parseMidwayCatalog(html, code);
            const admitted = admitMidwayRecords(
              records,
              code,
              previousVins,
              previousStocks,
            );
            assertMidwayYardQuality(records.length, admitted.rejected);
            return { ...admitted, processed: records.length };
          },
          catch: (cause) =>
            new MidwayProviderError({
              operation: "yard " + code + " complete inventory validation",
              cause,
            }),
        });
        if (options.onYards) yield* options.onYards([MIDWAY_YARDS[code]]);
        yield* options.onBatch(snapshot.vehicles);
        count += snapshot.vehicles.length;
        accounting.recordsProcessed += snapshot.processed;
        accounting.recordsRejected += snapshot.rejected;
        observedVins.push(...snapshot.rejectedVins);
        pagesProcessed++;
        cursor = {
          source: "midway",
          phase: "yard",
          yardCode: code === "MO38" ? "MO09" : "OO95",
          observedVins: snapshot.vins,
          stocks: snapshot.stocks,
        };
        continue;
      }
      if (cursor.phase === "yard") {
        const read = yield* turn(fetchMidwayCatalog("OO95", gate));
        if (Option.isNone(read)) break;
        const opening = read.value;
        nativePages++;
        const census = yield* ingestionValidation({
          try: () => openMidwayMakeCensus(opening, "OO95"),
          catch: (cause) =>
            new MidwayProviderError({
              operation: "Tulsa opening coverage witness",
              cause,
            }),
        });
        cursor = {
          source: "midway",
          phase: "tulsa",
          observedVins: cursor.observedVins,
          stocks: cursor.stocks,
          ...census,
          processed: 0,
          rejected: 0,
        };
        continue;
      }
      const tulsa = cursor;
      const [make, ...remaining] = tulsa.makes;
      if (make !== undefined) {
        const read = yield* turn(fetchMidwayMakeRecords("OO95", make, gate));
        if (Option.isNone(read)) break;
        const records = read.value;
        nativePages++;
        const admitted = yield* ingestionValidation({
          try: () =>
            admitMidwayRecords(
              records,
              "OO95",
              tulsa.observedVins,
              tulsa.stocks,
            ),
          catch: (cause) =>
            new MidwayProviderError({
              operation: "yard OO95 make " + make + " inventory validation",
              cause,
            }),
        });
        // Staged only; the run cannot publish until the closing witness and
        // yard-wide rejection guard below accept the whole Tulsa traversal.
        if (admitted.vehicles.length) yield* options.onBatch(admitted.vehicles);
        count += admitted.vehicles.length;
        accounting.recordsProcessed += records.length;
        accounting.recordsRejected += admitted.rejected;
        observedVins.push(...admitted.rejectedVins);
        const reproduced = new Set(records.map(midwayRecordDigest));
        cursor = {
          ...tulsa,
          makes: remaining,
          witness: tulsa.witness.filter((hash) => !reproduced.has(hash)),
          observedVins: admitted.vins,
          stocks: admitted.stocks,
          processed: tulsa.processed + records.length,
          rejected: tulsa.rejected + admitted.rejected,
        };
        continue;
      }
      const read = yield* turn(fetchMidwayCatalog("OO95", gate));
      if (Option.isNone(read)) break;
      const closing = read.value;
      nativePages++;
      yield* ingestionValidation({
        try: () => {
          closeMidwayMakeCensus(closing, "OO95", tulsa);
          assertMidwayYardQuality(tulsa.processed, tulsa.rejected);
        },
        catch: (cause) =>
          new MidwayProviderError({
            operation: "yard OO95 complete inventory validation",
            cause,
          }),
      });
      if (options.onYards) yield* options.onYards([MIDWAY_YARDS.OO95]);
      pagesProcessed++;
      cursor = { source: "midway", phase: "complete" };
    }
    return {
      source: "midway",
      status: cursor.phase === "complete" ? "complete" : "paused",
      cursor,
      count,
      pagesProcessed,
      errors: [],
      warnings: accounting.recordsRejected
        ? [
            "Midway rejected incomplete required donor records; valid rejected identities supply presence evidence only.",
          ]
        : [],
      observedVins,
      accounting,
    } satisfies MidwayStreamResult;
  }).pipe(
    ProviderChunkClock.deadline({
      duration: "5 minutes",
      onTimeout: () =>
        new MidwayProviderError({
          operation: "catalog budget",
          cause:
            "Five-minute crawl limit exceeded; no completed checkpoint returned",
        }),
    }),
  );
}

export function streamMidwayInventory<E, R>(options: MidwayOptions<E, R>) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamMidwayInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}

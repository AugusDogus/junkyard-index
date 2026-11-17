import { ingestionValidation } from "./ingestion-validation";
import { Effect, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import {
  BigtruckpageProviderError,
  fetchBigtruckpageCatalog,
  fetchBigtruckpageProfile,
} from "./bigtruckpage-client";
import {
  BigtruckpageCursor,
  BigtruckpageCursorSchema,
} from "./bigtruckpage-cursor";
import { parseBigtruckpageCatalog } from "./bigtruckpage-parser";
import {
  bigtruckpageRecordVin,
  transformBigtruckpageRecord,
  type BigtruckpageCanonicalVehicle,
} from "./bigtruckpage-transform";
import {
  BIGTRUCKPAGE_YARD,
  parseBigtruckpageProfile,
  type BigtruckpageYard,
} from "./bigtruckpage-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";

interface BigtruckpageOptions<E, R> {
  startCursor?: BigtruckpageCursor;
  maxPages?: number;
  onBatch: (
    vehicles: BigtruckpageCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: BigtruckpageYard[]) => Effect.Effect<void, E, R>;
}
export type BigtruckpageStreamResult = ConnectorChunkResult<
  "bigtruckpage",
  BigtruckpageCursor
>;
const parse = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new BigtruckpageProviderError({ operation, cause }),
  });

/** One request unit verifies ownership, opens a page or closes that same page.
 * Every native page must remain byte-stable before completion is accepted.
 */
export function streamBigtruckpageInventoryWithRequestGate<E, R>(
  options: BigtruckpageOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = BigtruckpageCursorSchema.safeParse(
      options.startCursor ?? BigtruckpageCursor.initial,
    );
    const maxPages = options.maxPages ?? 16;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* Effect.fail(
        new BigtruckpageProviderError({
          operation: "checkpoint",
          cause: "Use a validated BigTruckPage cursor and 1-32 request units",
        }),
      );
    let cursor: BigtruckpageCursor = parsed.data;
    let count = 0;
    let pagesProcessed = 0;
    const observedVins: string[] = [];
    const accounting = {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    while (cursor.phase !== "complete" && pagesProcessed < maxPages) {
      switch (cursor.phase) {
        case "profile": {
          const html = yield* fetchBigtruckpageProfile(gate);
          const profile = yield* parse("seller physical ownership", () =>
            parseBigtruckpageProfile(html),
          );
          cursor = {
            source: "bigtruckpage",
            version: 1,
            phase: "catalog",
            profile,
            pages: [],
          };
          if (options.onYards) yield* options.onYards([BIGTRUCKPAGE_YARD]);
          break;
        }
        case "catalog": {
          const number = cursor.pages.length + 1;
          const html = yield* fetchBigtruckpageCatalog(number, gate);
          const page = yield* parse("catalog page " + number, () =>
            parseBigtruckpageCatalog(html, number),
          );
          const pages = [...cursor.pages, page];
          const next = yield* parse(
            "native enumeration and required-field quality",
            () =>
              BigtruckpageCursorSchema.parse(
                number === page.lastPage
                  ? { ...cursor, phase: "verify", pages, nextPage: 1 }
                  : { ...cursor, pages },
              ),
          );
          const vehicles: BigtruckpageCanonicalVehicle[] = [];
          for (const record of page.records) {
            accounting.recordsProcessed++;
            const result = transformBigtruckpageRecord(record);
            if (result.status === "available") vehicles.push(result.vehicle);
            else {
              accounting.recordsRejected++;
              const vin = bigtruckpageRecordVin(record);
              if (vin) observedVins.push(vin);
            }
          }
          if (options.onYards) yield* options.onYards([BIGTRUCKPAGE_YARD]);
          if (vehicles.length) yield* options.onBatch(vehicles);
          count += vehicles.length;
          cursor = next;
          break;
        }
        case "verify": {
          const expected = cursor.pages[cursor.nextPage - 1];
          if (!expected)
            return yield* Effect.fail(
              new BigtruckpageProviderError({
                operation: "closing checkpoint",
                cause: "Ordered native page is missing",
              }),
            );
          const html = yield* fetchBigtruckpageCatalog(cursor.nextPage, gate);
          const actual = yield* parse(
            "closing catalog page " + cursor.nextPage,
            () => parseBigtruckpageCatalog(html, expected.page),
          );
          if (JSON.stringify(actual) !== JSON.stringify(expected))
            return yield* Effect.fail(
              new BigtruckpageProviderError({
                operation: "catalog stability",
                cause:
                  "Native inventory page changed during traversal; restart the complete bounded census",
              }),
            );
          cursor =
            cursor.nextPage === cursor.pages.length
              ? { source: "bigtruckpage", version: 1, phase: "complete" }
              : { ...cursor, nextPage: cursor.nextPage + 1 };
          break;
        }
      }
      pagesProcessed++;
    }
    return {
      source: "bigtruckpage",
      status: cursor.phase === "complete" ? "complete" : "paused",
      cursor,
      count,
      pagesProcessed,
      errors: [],
      observedVins,
      accounting,
      warnings: accounting.recordsRejected
        ? [
            "BigTruckPage rejected incomplete or conflicting required donor metadata; valid rejected VINs supply presence evidence only.",
          ]
        : [],
    } satisfies BigtruckpageStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "2 minutes",
      onTimeout: () =>
        new BigtruckpageProviderError({
          operation: "crawl budget",
          cause:
            "Two-minute chunk limit exceeded; no completed checkpoint returned",
        }),
    }),
  );
}
export function streamBigtruckpageInventory<E, R>(
  options: BigtruckpageOptions<E, R>,
) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamBigtruckpageInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}

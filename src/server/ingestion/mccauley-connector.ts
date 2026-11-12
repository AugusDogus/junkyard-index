import { Effect, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import { fetchMccauleyPage, MccauleyProviderError } from "./mccauley-client";
import { MccauleyCursor, MccauleyCursorSchema } from "./mccauley-cursor";
import {
  parseMccauleyCatalog,
  parseMccauleyCurrent,
  parseMccauleyDetail,
} from "./mccauley-parser";
import type { MccauleyCanonicalVehicle } from "./mccauley-record";
import {
  mccauleySnapshot,
  validateMccauleySnapshot,
} from "./mccauley-snapshot";
import {
  MCCAULEY_CURRENT,
  MCCAULEY_INDEX,
  MCCAULEY_YARD,
  type MccauleyYard,
} from "./mccauley-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";

interface MccauleyOptions<E, R> {
  startCursor?: MccauleyCursor;
  maxPages?: number;
  onBatch: (vehicles: MccauleyCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: MccauleyYard[]) => Effect.Effect<void, E, R>;
}
export type MccauleyStreamResult = ConnectorChunkResult<
  "mccauley",
  MccauleyCursor
>;
const parse = <A>(operation: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => new MccauleyProviderError({ operation, cause }),
  });

/** One unit is one native request. A bounded census is emitted only after both
 * closing lists and all quality guards pass, so partial snapshots cannot remove
 * prior inventory or silently drop the explicitly described unidentified MDX.
 */
export function streamMccauleyInventoryWithRequestGate<E, R>(
  options: MccauleyOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const validated = MccauleyCursorSchema.safeParse(
      options.startCursor ?? MccauleyCursor.initial,
    );
    const budget = options.maxPages ?? 8;
    if (
      !validated.success ||
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 24
    )
      return yield* Effect.fail(
        new MccauleyProviderError({
          operation: "checkpoint",
          cause: "Use a validated McCauley cursor and 1-24 request units",
        }),
      );
    let cursor: MccauleyCursor = validated.data;
    let pagesProcessed = 0;
    let count = 0;
    let observedVins: string[] = [];
    let accounting = {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    while (cursor.phase !== "complete" && pagesProcessed < budget) {
      switch (cursor.phase) {
        case "start": {
          const html = yield* fetchMccauleyPage(MCCAULEY_INDEX, gate);
          const catalog = yield* parse("Parts Vehicles index", () =>
            parseMccauleyCatalog(html),
          );
          cursor = {
            source: "mccauley",
            version: 1,
            phase: "current-list",
            catalog,
          };
          break;
        }
        case "current-list": {
          const html = yield* fetchMccauleyPage(MCCAULEY_CURRENT, gate);
          const current = yield* parse("current parting list", () =>
            parseMccauleyCurrent(html),
          );
          cursor = { ...cursor, phase: "details", current, details: [] };
          break;
        }
        case "details": {
          const post = cursor.catalog.posts[cursor.details.length];
          if (!post)
            return yield* Effect.fail(
              new MccauleyProviderError({
                operation: "detail checkpoint",
                cause: "Native donor destination is missing",
              }),
            );
          const html = yield* fetchMccauleyPage(post.url, gate);
          const detail = yield* parse("detail " + post.url, () =>
            parseMccauleyDetail(html, post),
          );
          const details = [...cursor.details, detail];
          const next = {
            ...cursor,
            phase:
              details.length === cursor.catalog.posts.length
                ? "verify-index"
                : "details",
            details,
          };
          cursor = yield* parse("native detail checkpoint", () =>
            MccauleyCursorSchema.parse(next),
          );
          break;
        }
        case "verify-index": {
          const html = yield* fetchMccauleyPage(MCCAULEY_INDEX, gate);
          const actual = yield* parse("closing Parts Vehicles index", () =>
            parseMccauleyCatalog(html),
          );
          if (
            JSON.stringify(actual.posts) !==
            JSON.stringify(cursor.catalog.posts)
          )
            return yield* Effect.fail(
              new MccauleyProviderError({
                operation: "closing index",
                cause:
                  "Ordered native donor destinations or labels changed during traversal; restart the census",
              }),
            );
          cursor = { ...cursor, phase: "verify-current" };
          break;
        }
        case "verify-current": {
          const retained = cursor;
          const html = yield* fetchMccauleyPage(MCCAULEY_CURRENT, gate);
          const actual = yield* parse("closing current parting list", () =>
            parseMccauleyCurrent(html),
          );
          if (
            JSON.stringify(actual.headings) !==
            JSON.stringify(cursor.current.headings)
          )
            return yield* Effect.fail(
              new MccauleyProviderError({
                operation: "closing current list",
                cause:
                  "Ordered native current donor headers changed during traversal; restart the census",
              }),
            );
          const snapshot = yield* parse("complete source quality", () => {
            const value = mccauleySnapshot(retained.current, retained.details);
            validateMccauleySnapshot(value);
            return value;
          });
          count = snapshot.vehicles.length;
          if (options.onYards) yield* options.onYards([{ ...MCCAULEY_YARD }]);
          yield* options.onBatch(
            snapshot.vehicles.map((vehicle) => ({ ...vehicle })),
          );
          accounting = snapshot.accounting;
          observedVins = snapshot.observedVins;
          cursor = { source: "mccauley", version: 1, phase: "complete" };
          break;
        }
      }
      pagesProcessed++;
    }
    return {
      source: "mccauley",
      status: cursor.phase === "complete" ? "complete" : "paused",
      cursor,
      count,
      pagesProcessed,
      accounting,
      observedVins,
      errors: [],
      warnings: accounting.recordsRejected
        ? [
            "McCauley retained required-identity rejections, including every additional unnamed vehicle. Valid rejected VINs supply presence only.",
          ]
        : [],
    } satisfies MccauleyStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "2 minutes",
      onTimeout: () =>
        new MccauleyProviderError({
          operation: "chunk",
          cause: "Two-minute request-unit budget exceeded",
        }),
    }),
  );
}

export function streamMccauleyInventory<E, R>(options: MccauleyOptions<E, R>) {
  return Effect.scoped(
    Effect.gen(function* () {
      const limit = yield* RateLimiter.make({
        limit: 1,
        interval: "1600 millis",
      });
      // Pad every request on success and failure so serialized chunk boundaries
      // cannot reset the native minimum spacing with a newly created limiter.
      const gate: ProviderRequestGate = (request) =>
        limit(request).pipe(Effect.ensuring(Effect.sleep("1600 millis")));
      return yield* streamMccauleyInventoryWithRequestGate(options, gate);
    }),
  );
}

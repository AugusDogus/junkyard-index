import { ingestionValidation } from "./ingestion-validation";
import { Clock, Effect, RateLimiter } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  fetchBrandywinePage,
  BrandywineProviderError,
  type BrandywineFetchedPage,
} from "./brandywine-client";
import {
  BrandywineCursor,
  BrandywineCursorSchema,
  BRANDYWINE_MAX_RUN_BYTES,
  BRANDYWINE_MAX_RUN_MS,
  BRANDYWINE_MAX_RUN_REQUESTS,
  inspectBrandywineCursor,
  brandywineOpeningPlan,
  brandywineDonors,
} from "./brandywine-cursor";
import { BRANDYWINE_MAX_RESPONSE_BYTES } from "./brandywine-html";
import {
  parseBrandywineControl,
  type BrandywineControl,
} from "./brandywine-catalog";
import type { BrandywineDetail } from "./brandywine-record";
import { extractBrandywineDetail } from "./brandywine-parser";
import type { BrandywineCanonicalVehicle } from "./brandywine-transform";
import {
  BRANDYWINE_YARD,
  type BrandywineYard,
} from "./brandywine-yard-metadata";

type Baseline =
  | { startCursor: BrandywineCursor; previousAcceptedCount?: never }
  | { startCursor?: undefined; previousAcceptedCount: number | null };
type Options<E, R> = Baseline & {
  maxPages?: number;
  onBatch: (
    vehicles: BrandywineCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: BrandywineYard[]) => Effect.Effect<void, E, R>;
};
export interface BrandywineStreamResult {
  source: "brandywine";
  status: "paused" | "complete";
  cursor: BrandywineCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
const validated = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new BrandywineProviderError({ operation, cause }),
  });
function checkRunDeadline(cursor: BrandywineCursor, now: number) {
  if (
    cursor.startedAt === null ||
    now - cursor.startedAt > BRANDYWINE_MAX_RUN_MS
  )
    throw new Error(
      "Whole-run 48-hour deadline exceeded or crawl start is missing; restart a fresh complete native snapshot",
    );
}

/** Disabled source slice. One unit is one logical control, at most two GETs. */
export function streamBrandywineInventoryWithRequestGate<E, R>(
  options: Options<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const maxPages = options.maxPages ?? 3;
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 3)
      return yield* new BrandywineProviderError({
        operation: "request budget",
        cause: "Use an integer logical-control budget from 1 through 3",
      });
    let cursor: BrandywineCursor = yield* validated("checkpoint", () =>
      BrandywineCursorSchema.parse(
        options.startCursor ??
          BrandywineCursor.initial(options.previousAcceptedCount),
      ),
    );
    const empty: BrandywineStreamResult = {
      source: "brandywine",
      status: "paused",
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
    if (cursor.phase === "complete")
      return { ...empty, status: "complete" as const };
    const startTime = yield* Clock.currentTimeMillis;
    if (cursor.phase === "ready")
      cursor = yield* validated("crawl start", () =>
        BrandywineCursor.checkpoint({
          ...cursor,
          phase: "opening",
          startedAt: startTime,
        }),
      );
    const stopAt = startTime + 90_000;
    let pagesProcessed = 0;
    while (cursor.phase !== "complete" && pagesProcessed < maxPages) {
      const now = yield* Clock.currentTimeMillis;
      if (stopAt - now < 30_000) break;
      const inspected: ReturnType<typeof inspectBrandywineCursor> =
        yield* validated("remaining capacity", () => {
          const result = inspectBrandywineCursor(cursor);
          if (
            cursor.startedAt === null ||
            now - cursor.startedAt > BRANDYWINE_MAX_RUN_MS - 25_000 ||
            cursor.startedAt > now ||
            result.requests > BRANDYWINE_MAX_RUN_REQUESTS - 2 ||
            result.bytes >
              BRANDYWINE_MAX_RUN_BYTES - BRANDYWINE_MAX_RESPONSE_BYTES
          )
            throw new Error(
              "Whole-run 48-hour, request or complete-response byte allowance is exhausted; inspect source growth and restart a fresh full snapshot",
            );
          return result;
        });
      if (cursor.phase === "opening") {
        const url = inspected.plan.nextUrl;
        if (!url)
          return yield* new BrandywineProviderError({
            operation: "opening prefix",
            cause: "Next native published control is missing",
          });
        const response: BrandywineFetchedPage = yield* fetchBrandywinePage(
          url,
          gate,
        );
        const completedAt = yield* Clock.currentTimeMillis;
        cursor = yield* validated("opening " + url, (): BrandywineCursor => {
          checkRunDeadline(cursor, completedAt);
          const opening: BrandywineControl[] = [
            ...cursor.opening,
            parseBrandywineControl(response.html, url, response.receipt),
          ];
          const plan = brandywineOpeningPlan(opening);
          return BrandywineCursor.checkpoint({
            ...cursor,
            opening,
            phase: plan.complete ? "details" : "opening",
          });
        });
      } else if (cursor.phase === "details") {
        const donor: ReturnType<typeof brandywineDonors>[number] | undefined =
          inspected.donors[cursor.details.length];
        if (!donor)
          return yield* new BrandywineProviderError({
            operation: "detail prefix",
            cause: "Next source-bound native donor is missing",
          });
        const response: BrandywineFetchedPage = yield* fetchBrandywinePage(
          donor.url,
          gate,
        );
        const completedAt = yield* Clock.currentTimeMillis;
        cursor = yield* validated(
          "detail " + donor.stock,
          (): BrandywineCursor => {
            checkRunDeadline(cursor, completedAt);
            const details: BrandywineDetail[] = [
              ...cursor.details,
              extractBrandywineDetail(
                response.html,
                donor.url,
                response.receipt,
              ),
            ];
            return BrandywineCursor.checkpoint({
              ...cursor,
              details,
              phase:
                details.length === inspected.donors.length
                  ? "closing"
                  : "details",
            });
          },
        );
      } else {
        const opening: BrandywineControl | undefined =
          cursor.opening[cursor.closing.length];
        if (!opening)
          return yield* new BrandywineProviderError({
            operation: "closing prefix",
            cause: "Opening native control is missing",
          });
        const response: BrandywineFetchedPage = yield* fetchBrandywinePage(
          opening.url,
          gate,
        );
        const completedAt = yield* Clock.currentTimeMillis;
        cursor = yield* validated(
          "closing " + opening.url,
          (): BrandywineCursor => {
            checkRunDeadline(cursor, completedAt);
            const closing: BrandywineControl[] = [
              ...cursor.closing,
              parseBrandywineControl(
                response.html,
                opening.url,
                response.receipt,
              ),
            ];
            return BrandywineCursor.checkpoint({
              ...cursor,
              closing,
              phase:
                closing.length === cursor.opening.length
                  ? "complete"
                  : "closing",
            });
          },
        );
      }
      pagesProcessed++;
    }
    if (cursor.phase !== "complete" && pagesProcessed === 0)
      return yield* new BrandywineProviderError({
        operation: "chunk progress",
        cause:
          "No native control fits the remaining chunk deadline; retain the last validated checkpoint",
      });
    if (cursor.phase !== "complete")
      return { ...empty, cursor, pagesProcessed };
    const snapshot = yield* validated("terminal snapshot", () =>
      inspectBrandywineCursor(cursor),
    );
    yield* options.onBatch(snapshot.vehicles);
    if (options.onYards) yield* options.onYards([{ ...BRANDYWINE_YARD }]);
    return {
      ...empty,
      status: "complete",
      cursor,
      count: snapshot.vehicles.length,
      pagesProcessed,
      observedVins: snapshot.observedVins,
      accounting: snapshot.accounting,
      warnings: snapshot.accounting.recordsRejected
        ? [
            "Brandywine rejected incomplete or conflicting native donors; genuine rejected identities supply presence only.",
          ]
        : [],
    } satisfies BrandywineStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "90 seconds",
      onTimeout: () =>
        new BrandywineProviderError({
          operation: "chunk deadline",
          cause:
            "90-second active deadline exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}

export const BRANDYWINE_REQUEST_GAP_MS = 1600;
export function streamBrandywineInventory<E, R>(options: Options<E, R>) {
  return Effect.scoped(
    Effect.gen(function* () {
      // A fresh chunk cannot burst against the preceding chunk's physical GETs.
      yield* Effect.sleep("1600 millis");
      const limiter = yield* RateLimiter.make({
        limit: 1,
        interval: "1600 millis",
      });
      return yield* streamBrandywineInventoryWithRequestGate(
        options,
        (request) =>
          limiter(request).pipe(Effect.ensuring(Effect.sleep("1600 millis"))),
      );
    }),
  ).pipe(
    Effect.timeoutFail({
      duration: "2 minutes",
      onTimeout: () =>
        new BrandywineProviderError({
          operation: "live chunk deadline",
          cause:
            "Two-minute total deadline exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}

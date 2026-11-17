import { validationRejection } from "./ingestion-validation";
import { Data, Effect, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import {
  fetchRtpContext,
  fetchRtpPage,
  type RtpYard,
  type RtpRecord,
} from "./rtp-client";
import { RtpCursor, RtpCursorSchema, type RtpYardCode } from "./rtp-cursor";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";
import { transformRtpRecord, type RtpCanonicalVehicle } from "./rtp-transform";
import { RTP_YARDS } from "./rtp-yard-metadata";

export class RtpStreamError extends Data.TaggedError("RtpStreamError")<{
  message: string;
}> {}
interface RtpOptions<E, R> {
  startCursor?: RtpCursor;
  maxPages?: number;
  onBatch: (vehicles: RtpCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: RtpYard[]) => Effect.Effect<void, E, R>;
}
export type RtpStreamResult = ConnectorChunkResult<"rtp", RtpCursor>;

export function streamRtpInventoryWithRequestGate<E, R>(
  options: RtpOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = RtpCursorSchema.safeParse(
      options.startCursor ?? RtpCursor.initial,
    );
    const maxPages = options.maxPages ?? 2;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 200
    )
      return yield* new RtpStreamError({
        message:
          "Invalid RTP checkpoint or page budget; use a validated cursor and 1-200 pages",
      });
    let cursor: RtpCursor = parsed.data;
    const accounting = {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    const observedVins = new Set<string>();
    const seenVins = new Set<string>();
    let pagesProcessed = 0;
    let count = 0;
    while (cursor.phase !== "complete" && pagesProcessed < maxPages) {
      const yardCode = cursor.yardCode;
      const context = yield* fetchRtpContext(yardCode, gate);
      // Each checkpoint refreshes its public CSRF state; reuse it within this yard.
      while (
        cursor.phase !== "complete" &&
        cursor.yardCode === yardCode &&
        pagesProcessed < maxPages
      ) {
        const offset: number = cursor.phase === "start" ? 0 : cursor.offset;
        const page: { total: number; records: RtpRecord[] } =
          yield* fetchRtpPage(yardCode, offset, context.nonce, gate);
        if (cursor.phase === "page" && cursor.total !== page.total)
          return yield* new RtpStreamError({
            message: `RTP yard ${yardCode} total changed from ${cursor.total} to ${page.total}; start a fresh run to prove complete enumeration`,
          });
        let lastStock: string =
          cursor.phase === "start" ? "" : cursor.lastStock;
        let rejected: number = cursor.phase === "start" ? 0 : cursor.rejected;
        let excluded: number = cursor.phase === "start" ? 0 : cursor.excluded;
        let emitted: number = cursor.phase === "start" ? 0 : cursor.emitted;
        const batch: RtpCanonicalVehicle[] = [];
        for (const record of page.records) {
          // Canonical stocks are optional. This source's stock-sorted pagination
          // still needs its ordering key to prove that no rows were skipped.
          if (!record.stock_number)
            return yield* new RtpStreamError({
              message: `RTP yard ${yardCode} offset ${offset} has no valid source stock ordering key; no advanced checkpoint returned. Inspect native inventory ordering before retrying the same cursor.`,
            });
          if (record.stock_number <= lastStock)
            return yield* new RtpStreamError({
              message: `RTP yard ${yardCode} offset ${offset} repeated or reordered stock ${record.stock_number}; no advanced checkpoint returned`,
            });
          lastStock = record.stock_number;
          accounting.recordsProcessed++;
          const transformed = transformRtpRecord(record, context.yard);
          if (transformed.status === "unavailable") {
            excluded++;
            accounting.recordsExcluded++;
          } else if (transformed.status === "incomplete") {
            rejected++;
            accounting.recordsRejected++;
            if (transformed.vin) observedVins.add(transformed.vin);
          } else {
            // Counts cover source rows; VIN duplicates are independently rejected by shared validation.
            emitted++;
            if (seenVins.has(transformed.vehicle.vin))
              accounting.duplicateVehicles++;
            else {
              seenVins.add(transformed.vehicle.vin);
              batch.push(transformed.vehicle);
            }
          }
        }
        const nextOffset: number = offset + page.records.length;
        const terminal: boolean = nextOffset === page.total;
        if (
          terminal &&
          (emitted === 0 ||
            rejected / (page.total - excluded) >
              SourceValidationPolicy.maximumRejectionRatio)
        )
          return yield* validationRejection(
            new RtpStreamError({
              message: `RTP yard ${yardCode} rejected ${rejected} of ${page.total - excluded} available records or has no complete vehicles; exceeds per-yard quality requirements, no terminal checkpoint returned`,
            }),
          );
        if (options.onYards) yield* options.onYards([context.yard]);
        if (batch.length) yield* options.onBatch(batch);
        count += batch.length;
        pagesProcessed++;
        const nextYard: RtpYardCode | null = RTP_YARDS[yardCode].next;
        cursor = terminal
          ? nextYard === null
            ? { source: "rtp", phase: "complete" }
            : { source: "rtp", phase: "start", yardCode: nextYard }
          : {
              source: "rtp",
              phase: "page",
              yardCode,
              offset: nextOffset,
              total: page.total,
              lastStock,
              rejected,
              excluded,
              emitted,
            };
      }
    }
    const warnings = accounting.recordsRejected
      ? [
          `RTP rejected ${accounting.recordsRejected} incomplete vehicles; only independently valid VINs supply presence evidence.`,
        ]
      : [];
    return {
      source: "rtp",
      status: cursor.phase === "complete" ? "complete" : "paused",
      cursor,
      count,
      pagesProcessed,
      accounting,
      observedVins: [...observedVins],
      warnings,
      errors: [],
    } satisfies RtpStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "4 minutes",
      onTimeout: () =>
        new RtpStreamError({
          message:
            "RTP exceeded the four-minute checkpoint budget; retry the same cursor, no terminal checkpoint returned",
        }),
    }),
  );
}

export function streamRtpInventory<E, R>(options: RtpOptions<E, R>) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1500 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamRtpInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}

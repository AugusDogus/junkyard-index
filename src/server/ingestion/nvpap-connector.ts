import { validationRejection } from "./ingestion-validation";
import { Data, Effect, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import { fetchNvpapPage, fetchNvpapYards } from "./nvpap-client";
import {
  NvpapCursor,
  NvpapCursorSchema,
  NVPAP_FIRST_YEAR,
  NVPAP_LAST_YEAR,
  NVPAP_RESULT_CAP,
  type NvpapYardCode,
} from "./nvpap-cursor";
import { nvpapRecordKey, type NvpapRecord } from "./nvpap-parser";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";
import {
  transformNvpapRecord,
  type NvpapCanonicalVehicle,
} from "./nvpap-transform";
import { NVPAP_YARDS, type NvpapYard } from "./nvpap-yard-metadata";

export class NvpapStreamError extends Data.TaggedError("NvpapStreamError")<{
  message: string;
}> {}
interface NvpapOptions<E, R> {
  startCursor?: NvpapCursor;
  maxPages?: number;
  onBatch: (vehicles: NvpapCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: NvpapYard[]) => Effect.Effect<void, E, R>;
}
export type NvpapStreamResult = ConnectorChunkResult<"nvpap", NvpapCursor>;

export function streamNvpapInventoryWithRequestGate<E, R>(
  options: NvpapOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = NvpapCursorSchema.safeParse(
      options.startCursor ?? NvpapCursor.initial,
    );
    const maxPages = options.maxPages ?? 16;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* new NvpapStreamError({
        message:
          "Invalid Nevada checkpoint or query budget; use a validated cursor and 1-32 queries",
      });
    let cursor: NvpapCursor = parsed.data;
    const accounting = {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    let pagesProcessed = 0;
    let count = 0;
    const observedVins = new Set<string>();
    const seenVins = new Set<string>();
    if (cursor.phase === "complete")
      return {
        source: "nvpap",
        status: "complete",
        cursor,
        count,
        pagesProcessed,
        accounting,
        observedVins: [],
        warnings: [],
        errors: [],
      } satisfies NvpapStreamResult;
    const yards = yield* fetchNvpapYards(gate);
    while (cursor.phase !== "complete" && pagesProcessed < maxPages) {
      const yardCode: NvpapYardCode = cursor.yardCode;
      const yard = yards.find((entry) => entry.code === yardCode);
      if (!yard)
        return yield* new NvpapStreamError({
          message: "Verified Nevada yard " + yardCode + " is missing",
        });
      if (cursor.phase === "start") {
        const controls: NvpapRecord[] = yield* fetchNvpapPage(
          yardCode,
          0,
          gate,
        );
        if (controls.length === 0)
          return yield* new NvpapStreamError({
            message:
              "Nevada yard " +
              yardCode +
              " returned no broad positive controls; no checkpoint accepted",
          });
        cursor = {
          source: "nvpap",
          phase: "year",
          yardCode,
          year: NVPAP_FIRST_YEAR,
          pending: controls.map(nvpapRecordKey),
          processed: 0,
          rejected: 0,
          emitted: 0,
        };
        pagesProcessed++;
        continue;
      }
      const records = yield* fetchNvpapPage(yardCode, cursor.year, gate);
      if (records.length >= NVPAP_RESULT_CAP)
        return yield* new NvpapStreamError({
          message:
            "Nevada yard " +
            yardCode +
            " year " +
            cursor.year +
            " reached the 200-result cap; enumeration is incomplete, inspect native partitions before retrying",
        });
      const recovered = new Set(records.map(nvpapRecordKey));
      const pending: string[] = cursor.pending.filter(
        (key) => !recovered.has(key),
      );
      let rejected: number = cursor.rejected;
      let emitted: number = cursor.emitted;
      const batch: NvpapCanonicalVehicle[] = [];
      for (const record of records) {
        accounting.recordsProcessed++;
        const result = transformNvpapRecord(record, yard);
        if (result.status === "incomplete") {
          rejected++;
          accounting.recordsRejected++;
          if (result.vin) observedVins.add(result.vin);
        } else {
          emitted++;
          if (seenVins.has(result.vehicle.vin)) accounting.duplicateVehicles++;
          else {
            seenVins.add(result.vehicle.vin);
            batch.push(result.vehicle);
          }
        }
      }
      const processed: number = cursor.processed + records.length;
      const terminal: boolean = cursor.year === NVPAP_LAST_YEAR;
      if (
        terminal &&
        (pending.length > 0 ||
          emitted === 0 ||
          rejected / processed > SourceValidationPolicy.maximumRejectionRatio)
      )
        return yield* validationRejection(
          new NvpapStreamError({
            message:
              "Nevada yard " +
              yardCode +
              " failed completion: " +
              pending.length +
              " broad controls missing, " +
              emitted +
              " complete and " +
              rejected +
              " rejected of " +
              processed +
              " records; retain the previous accepted snapshot and inspect source quality",
          }),
        );
      if (options.onYards) yield* options.onYards([yard]);
      if (batch.length > 0) yield* options.onBatch(batch);
      count += batch.length;
      pagesProcessed++;
      const next: NvpapYardCode | null = NVPAP_YARDS[yardCode].next;
      cursor = terminal
        ? next === null
          ? { source: "nvpap", phase: "complete" }
          : { source: "nvpap", phase: "start", yardCode: next }
        : {
            source: "nvpap",
            phase: "year",
            yardCode,
            year: cursor.year + 1,
            pending,
            processed,
            rejected,
            emitted,
          };
    }
    return {
      source: "nvpap",
      status: cursor.phase === "complete" ? "complete" : "paused",
      cursor,
      count,
      pagesProcessed,
      accounting,
      observedVins: [...observedVins],
      warnings: accounting.recordsRejected
        ? [
            "Nevada rejected " +
              accounting.recordsRejected +
              " incomplete donors; independently valid VINs supply presence evidence only.",
          ]
        : [],
      errors: [],
    } satisfies NvpapStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new NvpapStreamError({
          message:
            "Nevada exceeded the three-minute checkpoint budget; retry the same cursor, no advanced checkpoint returned",
        }),
    }),
  );
}

export function streamNvpapInventory<E, R>(options: NvpapOptions<E, R>) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamNvpapInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}

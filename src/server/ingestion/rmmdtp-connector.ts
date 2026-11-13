import { Effect } from "effect";
import { z } from "zod";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { readRmmdtpPage } from "./rmmdtp-client";
import { RmmdtpContract, type RmmdtpYard } from "./rmmdtp-contract";
import {
  RmmdtpCursor,
  RMMDTP_MAX_REQUESTS,
  RMMDTP_MAX_TOTAL_BYTES,
} from "./rmmdtp-cursor";
import { RMMDTP_MAX_BODY_BYTES } from "./rmmdtp-html";
import {
  RmmdtpResult,
  type RmmdtpError,
  type RmmdtpResult as Result,
} from "./rmmdtp-result";
import { rmmdtpSnapshot, validateRmmdtpSnapshot } from "./rmmdtp-snapshot";
import { rmmdtpAdvance, rmmdtpNextUrl } from "./rmmdtp-traversal";
import type { RmmdtpCanonicalVehicle } from "./rmmdtp-transform";

export interface RmmdtpOptions<E, R> {
  contract: RmmdtpContract;
  previousUniqueInventory: number | null;
  startCursor?: unknown;
  maxPages?: number;
  readPage: (url: string) => Effect.Effect<string, RmmdtpError>;
  onBatch: (vehicles: RmmdtpCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: RmmdtpYard[]) => Effect.Effect<void, E, R>;
}
export interface RmmdtpStreamResult {
  source: "rmmdtp";
  status: "paused" | "complete";
  cursor: RmmdtpCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
const unwrap = <T>(result: Result<T>) =>
  result.ok ? Effect.succeed(result.value) : Effect.fail(result.error);
export function streamRmmdtpInventory<E, R>(options: RmmdtpOptions<E, R>) {
  return Effect.gen(function* () {
    const contract = yield* unwrap(RmmdtpContract.parse(options.contract));
    const previous = yield* unwrap(
      RmmdtpResult.boundary("previous complete inventory", () =>
        z
          .number()
          .int()
          .nonnegative()
          .nullable()
          .parse(options.previousUniqueInventory),
      ),
    );
    const budget = options.maxPages ?? 8;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 8)
      return yield* Effect.fail(
        RmmdtpResult.error(
          "run options",
          "Use 1 to 8 native requests per chunk",
        ),
      );
    let cursor = yield* unwrap(
      RmmdtpCursor.parse(
        options.startCursor ?? RmmdtpCursor.initial(contract),
        contract,
      ),
    );
    const summary: RmmdtpStreamResult = {
      source: "rmmdtp",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 0,
      errors: [],
      warnings: [],
      observedVins: [],
      accounting: {
        recordsProcessed: 0,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      },
    };
    while (cursor.phase !== "complete") {
      if (cursor.phase === "ready") {
        const snapshot = yield* unwrap(
          RmmdtpResult.boundary("native snapshot", () =>
            rmmdtpSnapshot(
              cursor.pages.flatMap((page) => page.records),
              contract,
            ),
          ),
        );
        yield* unwrap(validateRmmdtpSnapshot(snapshot, contract, previous));
        if (options.onYards) yield* options.onYards([{ ...contract.yard }]);
        yield* options.onBatch(snapshot.vehicles);
        summary.count = snapshot.vehicles.length;
        summary.accounting = snapshot.accounting;
        summary.observedVins = snapshot.observedVins;
        summary.warnings = [
          "RMMDTP preserves valid rejected VIN presence and excludes unconflicted Complete listings. Native descriptions remain explicit source claims; optional metadata never gates donors.",
        ];
        cursor = yield* unwrap(
          RmmdtpCursor.checkpoint({ ...cursor, phase: "complete" }, contract),
        );
      } else {
        if (summary.pagesProcessed >= budget) break;
        if (
          cursor.requests >= RMMDTP_MAX_REQUESTS ||
          cursor.bytes > RMMDTP_MAX_TOTAL_BYTES - RMMDTP_MAX_BODY_BYTES
        )
          return yield* Effect.fail(
            RmmdtpResult.error(
              "whole-run budget",
              "Incomplete native graph reached 800 requests or the 128 MiB response budget",
            ),
          );
        const url = yield* unwrap(rmmdtpNextUrl(cursor));
        const raw = yield* options.readPage(url);
        cursor = yield* unwrap(rmmdtpAdvance(cursor, raw, contract));
        summary.pagesProcessed++;
      }
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies RmmdtpStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        RmmdtpResult.error(
          "chunk deadline",
          "Three-minute limit exceeded; retain the last validated checkpoint",
        ),
    }),
  );
}
/** Disabled until explicitly admitted and invoked by root-owned registration. */
export const streamRmmdtpInventoryFromProvider = <E, R>(
  options: Omit<RmmdtpOptions<E, R>, "readPage">,
) => streamRmmdtpInventory({ ...options, readPage: readRmmdtpPage });

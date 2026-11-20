import { Effect, Option } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import { ProviderChunkClock } from "./provider-chunk-clock";
import { sharedProviderHostTurn } from "./shared-provider-host";
import {
  readDentonPage,
  DENTON_MAX_BODY_BYTES,
  type DentonResponse,
} from "./denton-client";
import {
  DentonCursor,
  DENTON_MAX_REQUESTS,
  DENTON_MAX_TOTAL_BYTES,
  DENTON_MINIMUM_INVENTORY,
  dentonBadgeCoverage,
  dentonCensusPlan,
  dentonNextUrl,
  dentonReady,
  type DentonProgress,
} from "./denton-cursor";
import { DentonError, dentonBoundary, type DentonResult } from "./denton-html";
import { DentonSnapshot } from "./denton-snapshot";
import { dentonPage, dentonTasks } from "./denton-traversal";
import {
  transformDentonVehicle,
  type DentonCanonicalVehicle,
} from "./denton-transform";
import { DENTON_YARD } from "./denton-yard-metadata";
import { ModelCensus } from "./model-census";

export interface DentonOptions<E, R> {
  previousAcceptedCount: number | null;
  startCursor?: unknown;
  /** Terminal cursor of the last accepted, published run; read only when the
   * start cursor has not begun a census yet. */
  previousCursor?: unknown;
  now?: () => number;
  /** One unit is one physical GET, including the native slash HTTP 301. */
  maxPages?: number;
  readPage: (url: string) => Effect.Effect<DentonResponse, DentonError>;
  onBatch: (vehicles: DentonCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: (typeof DENTON_YARD)[]) => Effect.Effect<void, E, R>;
}
export interface DentonStreamResult {
  source: "denton";
  status: "paused" | "complete";
  cursor: DentonCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
  rejections: DentonSnapshot["rejections"];
}
const unwrap = <T>(result: DentonResult<T>): Effect.Effect<T, DentonError> =>
  result.ok ? Effect.succeed(result.value) : Effect.fail(result.error);

/** Union of every read and carried model page plus the opening arrivals. */
export function dentonCompleteSnapshot(cursor: DentonProgress) {
  return dentonBoundary("complete donor union", () => {
    if (!dentonReady(cursor))
      throw new Error("Opening/details/closing proof is incomplete");
    const tasks = dentonTasks(cursor.opening);
    if (!tasks.some((task) => task.kind === "arrivals"))
      throw new Error("Arrival union is missing its opening surface");
    return DentonSnapshot.build(
      cursor.opening.flatMap((entry, index) => {
        const task = tasks[index];
        if (!task) throw new Error("Opening entry lost its literal task");
        return entry.kind === "model" || entry.kind === "arrivals"
          ? [dentonPage(entry, task, cursor.opening)]
          : [];
      }),
    );
  });
}

/** No staging or accounting escapes until the entire native corpus closes. */
export function streamDentonInventory<E, R>(options: DentonOptions<E, R>) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 8;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 8)
      return yield* Effect.fail(
        DentonError.create(
          "request budget",
          "Use an integer chunk budget from 1 to 8 physical GETs",
        ),
      );
    const initial =
      options.startCursor === undefined
        ? DentonCursor.initial(options.previousAcceptedCount)
        : typeof options.startCursor === "string"
          ? DentonCursor.fromWire(
              options.startCursor,
              options.previousAcceptedCount,
            )
          : DentonCursor.parse(
              options.startCursor,
              options.previousAcceptedCount,
            );
    let cursor: DentonCursor = yield* unwrap(initial);
    const begun = yield* unwrap(
      DentonCursor.begin(
        cursor,
        (options.now ?? Date.now)(),
        options.previousCursor,
        options.previousAcceptedCount,
      ),
    );
    cursor = begun.cursor;
    const summary: DentonStreamResult = {
      source: "denton",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 0,
      errors: [],
      warnings: begun.warning ? [begun.warning] : [],
      observedVins: [],
      rejections: [],
      accounting: {
        recordsProcessed: 0,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      },
    };
    while (cursor.phase !== "complete") {
      if (dentonReady(cursor)) {
        const ready = cursor;
        yield* unwrap(dentonBadgeCoverage(ready));
        const snapshot = yield* unwrap(dentonCompleteSnapshot(ready));
        yield* unwrap(
          DentonSnapshot.validate(snapshot, {
            terminal: true,
            minimumUniqueInventory: DENTON_MINIMUM_INVENTORY,
            previousAcceptedCount: options.previousAcceptedCount,
          }),
        );
        const complete = yield* unwrap(
          DentonCursor.complete(ready, options.previousAcceptedCount),
        );
        const plan = yield* unwrap(
          dentonBoundary("census summary", () => dentonCensusPlan(ready)),
        );
        if (options.onYards) yield* options.onYards([{ ...DENTON_YARD }]);
        yield* options.onBatch(snapshot.vehicles.map(transformDentonVehicle));
        summary.count = snapshot.vehicles.length;
        summary.accounting = snapshot.accounting;
        summary.observedVins = snapshot.observedVins;
        summary.rejections = snapshot.rejections;
        summary.warnings = [
          ...summary.warnings,
          "Denton retained required rejects, all valid rejected/conflicting identities and the AD80068 destination quarantine. Model badge counts select census reads and bound the read plus carried model cards; optional metadata is nullable.",
          "Denton " + ModelCensus.summary(plan),
        ];
        cursor = complete;
      } else {
        if (summary.pagesProcessed >= budget) break;
        if (
          cursor.requests >= DENTON_MAX_REQUESTS ||
          cursor.bytes > DENTON_MAX_TOTAL_BYTES - DENTON_MAX_BODY_BYTES
        )
          return yield* Effect.fail(
            DentonError.create(
              "whole-run bound",
              "Native traversal is incomplete at its request or body bound",
            ),
          );
        const url = yield* unwrap(dentonNextUrl(cursor));
        // A native slash 301 takes its own turn: the cursor holds it as a
        // pending redirect, so either GET advances the chunk.
        const response = yield* options
          .readPage(url)
          .pipe(
            sharedProviderHostTurn(url),
            ProviderChunkClock.unlessDeferred(summary.pagesProcessed > 0),
          );
        if (Option.isNone(response)) break;
        cursor = yield* unwrap(
          DentonCursor.advance(
            cursor,
            response.value,
            options.previousAcceptedCount,
          ),
        );
        summary.pagesProcessed++;
      }
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies DentonStreamResult;
  }).pipe(
    ProviderChunkClock.deadline({
      duration: "3 minutes",
      onTimeout: () =>
        DentonError.create(
          "chunk deadline",
          "Three-minute deadline exceeded; retain the last validated checkpoint",
        ),
    }),
  );
}
/** Unregistered and disabled until root wires this explicitly. */
export function streamDentonInventoryFromProvider<E, R>(
  options: Omit<DentonOptions<E, R>, "readPage">,
) {
  return streamDentonInventory({ ...options, readPage: readDentonPage });
}

export function streamDentonInventoryWithRequestGate<E, R>(
  options: Omit<DentonOptions<E, R>, "readPage">,
  gate: ProviderRequestGate,
) {
  return streamDentonInventory({
    ...options,
    readPage: (url) => readDentonPage(url, gate),
  });
}

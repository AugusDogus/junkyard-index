import { Effect } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import { ProviderChunkClock } from "./provider-chunk-clock";
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
  dentonNextUrl,
  dentonReady,
} from "./denton-cursor";
import { DentonError, dentonBoundary, type DentonResult } from "./denton-html";
import { DentonSnapshot } from "./denton-snapshot";
import { dentonHash, dentonPage, dentonTasks } from "./denton-traversal";
import {
  transformDentonVehicle,
  type DentonCanonicalVehicle,
} from "./denton-transform";
import { DENTON_YARD } from "./denton-yard-metadata";

export interface DentonOptions<E, R> {
  previousAcceptedCount: number | null;
  startCursor?: unknown;
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

export function dentonCompleteSnapshot(cursor: DentonCursor) {
  return dentonBoundary("complete donor union", () => {
    if (!dentonReady(cursor))
      throw new Error("Opening/details/closing proof is incomplete");
    const tasks = dentonTasks(cursor.opening);
    const pages = cursor.opening.flatMap((entry, index) => {
      const task = tasks[index];
      if (!task) throw new Error("Opening entry lost its literal task");
      return entry.kind === "model" || entry.kind === "arrivals"
        ? [dentonPage(entry, task, cursor.opening)]
        : [];
    });
    const arrivalIndex = tasks.findIndex((task) => task.kind === "arrivals");
    const opening = cursor.opening[arrivalIndex],
      closing = cursor.closing[arrivalIndex],
      task = tasks[arrivalIndex];
    if (opening?.kind !== "arrivals" || closing?.kind !== "arrivals" || !task)
      throw new Error("Arrival union is missing an opening or closing surface");
    // Repeated captures do not manufacture duplicate observations. Preserve
    // actual within-surface multiplicity and every changed/rejected row.
    const seen = new Map<string, number>();
    for (const row of opening.page.records) {
      const key = dentonHash(row);
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const arrivals = dentonPage(closing, task, cursor.opening);
    arrivals.records = arrivals.records.filter(
      ({ fields, destinations, images }) => {
        const key = dentonHash({ fields, destinations, images }),
          count = seen.get(key) ?? 0;
        if (count > 0) {
          seen.set(key, count - 1);
          return false;
        }
        return true;
      },
    );
    return DentonSnapshot.build([...pages, arrivals]);
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
    let cursor = yield* unwrap(initial);
    const summary: DentonStreamResult = {
      source: "denton",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 0,
      errors: [],
      warnings: [],
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
        const snapshot = yield* unwrap(dentonCompleteSnapshot(cursor));
        yield* unwrap(
          DentonSnapshot.validate(snapshot, {
            terminal: true,
            minimumUniqueInventory: DENTON_MINIMUM_INVENTORY,
            previousAcceptedCount: options.previousAcceptedCount,
          }),
        );
        const complete = yield* unwrap(
          DentonCursor.complete(cursor, options.previousAcceptedCount),
        );
        if (options.onYards) yield* options.onYards([{ ...DENTON_YARD }]);
        yield* options.onBatch(snapshot.vehicles.map(transformDentonVehicle));
        summary.count = snapshot.vehicles.length;
        summary.accounting = snapshot.accounting;
        summary.observedVins = snapshot.observedVins;
        summary.rejections = snapshot.rejections;
        summary.warnings = [
          "Denton retained required rejects, all valid rejected/conflicting identities and the AD80068 destination quarantine. Badge counts are diagnostic; optional metadata is nullable.",
        ];
        cursor = complete;
      } else {
        if (summary.pagesProcessed >= budget) break;
        if (yield* ProviderChunkClock.shouldYield(summary.pagesProcessed))
          break;
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
        const response = yield* options.readPage(url);
        cursor = yield* unwrap(
          DentonCursor.advance(cursor, response, options.previousAcceptedCount),
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

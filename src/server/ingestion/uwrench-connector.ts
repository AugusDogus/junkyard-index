import { Effect, RateLimiter } from "effect";
import {
  fetchUwrenchContext,
  fetchUwrenchSearch,
  UwrenchProviderError,
  validateUwrench,
} from "./uwrench-client";
import {
  UwrenchCursor,
  UwrenchCursorSchema,
  type UwrenchRunningCursor,
} from "./uwrench-cursor";
import {
  appendUwrenchRecords,
  rebuildUwrenchPrefix,
  uwrenchQueryHash,
  validateUwrenchScan,
  type UwrenchSnapshot,
} from "./uwrench-snapshot";
import type { UwrenchCanonicalVehicle } from "./uwrench-transform";
import { UWRENCH_YARD, type UwrenchYard } from "./uwrench-yard-metadata";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import { ProviderChunkClock } from "./provider-chunk-clock";

export interface UwrenchOptions<E, R> {
  startCursor?: UwrenchCursor;
  /** Newly consumed scan or verification selectors; four context reads are additional. */
  maxPages?: number;
  onBatch: (vehicles: UwrenchCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: UwrenchYard[]) => Effect.Effect<void, E, R>;
}
export interface UwrenchStreamResult {
  source: "uwrench";
  status: "paused" | "complete";
  cursor: UwrenchCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
function terminalBatch(
  snapshot: UwrenchSnapshot,
  nativeStocks: readonly string[],
) {
  const native = new Set(nativeStocks);
  const order = [
    ...nativeStocks,
    ...[...snapshot.records.keys()]
      .filter((stock) => !native.has(stock))
      .sort(),
  ];
  const vehicles: UwrenchCanonicalVehicle[] = [];
  const presence = new Set<string>();
  let rejected = 0;
  for (const stock of order) {
    const disposition = snapshot.dispositions.get(stock);
    if (!disposition)
      throw new Error(
        "Tri-State terminal union lacks explicit disposition for " + stock,
      );
    if (disposition.status === "available") vehicles.push(disposition.vehicle);
    else {
      rejected++;
      if (disposition.vin) presence.add(disposition.vin);
    }
  }
  if (order.length !== snapshot.dispositions.size)
    throw new Error(
      "Tri-State terminal native/API union accounting is inconsistent",
    );
  return {
    vehicles,
    presence: [...presence],
    rejected,
    processed: order.length,
  };
}
export function streamUwrenchInventoryWithRequestGate<E, R>(
  options: UwrenchOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = UwrenchCursorSchema.safeParse(
      options.startCursor ?? UwrenchCursor.initial,
    );
    const maxPages = options.maxPages ?? 16;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 16
    )
      return yield* new UwrenchProviderError({
        operation: "checkpoint/budget",
        cause:
          "Use a validated source cursor and selector budget from 1 through 16",
      });
    const initial = parsed.data;
    const summary: UwrenchStreamResult = {
      source: "uwrench",
      status: "paused",
      cursor: initial,
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
    if (initial.phase === "complete")
      return { ...summary, status: "complete" as const };
    const budget = { used: 0 };
    const context = yield* fetchUwrenchContext(gate, budget);
    const prior =
      initial.phase === "start"
        ? null
        : yield* validateUwrench("rebuild complete retained prefix", () =>
            rebuildUwrenchPrefix(context, initial),
          );
    if (initial.phase === "start" || initial.phase === "scan") {
      const entries = initial.phase === "scan" ? [...initial.entries] : [];
      const scanReceipts =
        initial.phase === "scan" ? [...initial.scanReceipts] : [];
      while (
        scanReceipts.length < context.pairs.length &&
        summary.pagesProcessed < maxPages
      ) {
        if (yield* ProviderChunkClock.shouldYield(summary.pagesProcessed))
          break;
        const index = scanReceipts.length;
        const pair = context.pairs[index];
        if (!pair)
          return yield* new UwrenchProviderError({
            operation: "native query directory",
            cause: "Required literal pair is missing",
          });
        const response = yield* fetchUwrenchSearch(pair, gate, budget);
        yield* validateUwrench("whole-record selector append", () =>
          appendUwrenchRecords(
            entries,
            scanReceipts,
            pair,
            index,
            response.records,
            response.rawHash,
          ),
        );
        summary.pagesProcessed++;
      }
      const completeScan = scanReceipts.length === context.pairs.length;
      const cursor = yield* validateUwrench(
        "bounded next scan checkpoint",
        () => {
          const common = {
            contextHash: context.hash,
            pairCount: context.pairs.length,
            entries,
            scanReceipts,
          };
          return completeScan
            ? UwrenchCursor.checkpoint({
                ...common,
                phase: "verify",
                verificationReceipts: [],
              })
            : UwrenchCursor.checkpoint({ ...common, phase: "scan" });
        },
      );
      yield* validateUwrench("full source prefix and native joins", () => {
        const snapshot = rebuildUwrenchPrefix(context, cursor);
        if (completeScan) validateUwrenchScan(context, snapshot);
      });
      // Gathering makes no canonical callback or accounting claim. All source
      // rows are classified and emitted once, after verification and bookends.
      return { ...summary, cursor };
    }
    if (!prior)
      return yield* new UwrenchProviderError({
        operation: "verification checkpoint",
        cause: "Complete retained scan prefix is unavailable",
      });
    const verificationReceipts = [...initial.verificationReceipts];
    while (
      verificationReceipts.length < context.pairs.length &&
      summary.pagesProcessed < maxPages
    ) {
      if (yield* ProviderChunkClock.shouldYield(summary.pagesProcessed)) break;
      const index = verificationReceipts.length;
      const pair = context.pairs[index];
      const scan = initial.scanReceipts[index];
      if (!pair || !scan)
        return yield* new UwrenchProviderError({
          operation: "verification directory",
          cause: "Required retained query proof is missing",
        });
      const response = yield* fetchUwrenchSearch(pair, gate, budget);
      yield* validateUwrench("closing whole-query verification", () => {
        if (
          uwrenchQueryHash(pair, response.records) !== scan.stableHash ||
          JSON.stringify(
            response.records.map((record) => record.stock).sort(),
          ) !== JSON.stringify(scan.stocks)
        )
          throw new Error(
            "Tri-State earlier selector stock membership or whole stable source fields changed at query " +
              index,
          );
      });
      verificationReceipts.push({ rawHash: response.rawHash });
      summary.pagesProcessed++;
    }
    if (verificationReceipts.length < context.pairs.length) {
      const cursor: UwrenchRunningCursor = yield* validateUwrench(
        "bounded verification checkpoint",
        () => UwrenchCursor.checkpoint({ ...initial, verificationReceipts }),
      );
      return { ...summary, cursor };
    }
    yield* validateUwrench("terminal native/API union quality", () =>
      validateUwrenchScan(context, prior),
    );
    const closing = yield* fetchUwrenchContext(gate, budget);
    if (closing.hash !== context.hash)
      return yield* new UwrenchProviderError({
        operation: "terminal native/public controls",
        cause:
          "Native census, owner/config or API analytics changed during verification",
      });
    const batch = yield* validateUwrench(
      "terminal native-order classification",
      () =>
        terminalBatch(
          prior,
          context.rows.map((row) => row.stock),
        ),
    );
    const cursor = UwrenchCursorSchema.parse({
      source: "uwrench",
      phase: "complete",
    });
    const result = {
      ...summary,
      cursor,
      status: "complete" as const,
      count: batch.vehicles.length,
      observedVins: batch.presence,
      warnings: batch.rejected
        ? [
            "Tri-State rejected required native identities/metadata or active-scope-unproven API stocks; separately valid rejected identities supply presence only.",
          ]
        : [],
      accounting: {
        recordsProcessed: batch.processed,
        recordsExcluded: 0,
        recordsRejected: batch.rejected,
        duplicateVehicles: 0,
      },
    } satisfies UwrenchStreamResult;
    yield* options.onBatch(batch.vehicles);
    if (options.onYards) yield* options.onYards([{ ...UWRENCH_YARD }]);
    return result;
  }).pipe(
    ProviderChunkClock.deadline({
      duration: "3 minutes",
      onTimeout: () =>
        new UwrenchProviderError({
          operation: "chunk deadline",
          cause:
            "Three-minute chunk limit exceeded; retain the prior validated checkpoint",
        }),
    }),
  );
}
export function streamUwrenchInventory<E, R>(options: UwrenchOptions<E, R>) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamUwrenchInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}

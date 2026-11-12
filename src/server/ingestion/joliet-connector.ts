import { Effect, RateLimiter } from "effect";
import {
  fetchJolietContext,
  fetchJolietSearch,
  JolietProviderError,
  validateJoliet,
  type JolietContext,
} from "./joliet-client";
import {
  JolietCursor,
  JolietCursorSchema,
  type JolietSeen,
} from "./joliet-cursor";
import { inventoryVin } from "./inventory-vin";
import {
  jolietHash,
  jolietPairKey,
  type JolietPair,
  type JolietRecord,
} from "./joliet-parser";
import {
  jolietRecordIdentity,
  transformJolietRecord,
  type JolietCanonicalVehicle,
} from "./joliet-transform";
import { JOLIET_YARD, type JolietYard } from "./joliet-yard-metadata";
import { vinplusOptionalText, vinplusSourceDate } from "./vinplus-protocol";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";

interface JolietOptions<E, R> {
  startCursor?: JolietCursor;
  maxPages?: number;
  onBatch: (vehicles: JolietCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: JolietYard[]) => Effect.Effect<void, E, R>;
}
export type JolietStreamResult = ConnectorChunkResult<"joliet", JolietCursor>;
type QueryCursor = Extract<JolietCursor, { phase: "queries" }>;

function validateResume(cursor: QueryCursor, context: JolietContext): void {
  if (
    cursor.contextHash !== context.hash ||
    cursor.pairCount !== context.pairs.length
  )
    throw new Error(
      "Official Joliet owner, native table, public config or active counts changed during the crawl",
    );
  const rows = new Map(context.rows.map((row) => [row.stock, row]));
  const seen = new Map(cursor.seen.map((entry) => [entry.stock, entry]));
  for (const entry of cursor.seen) {
    const row = rows.get(entry.stock);
    if (
      !row ||
      (entry.vin && inventoryVin(entry.vin, String(row.year)) !== entry.vin)
    )
      throw new Error(
        "Checkpoint stock/year or VIN/serial does not bind to the current official Joliet table",
      );
  }
  const pairIndexes = new Map(
    context.pairs.map((pair, index) => [jolietPairKey(pair), index]),
  );
  for (const row of context.rows) {
    const index = pairIndexes.get(jolietPairKey(row));
    if (index === undefined)
      throw new Error("Checkpoint native pair index is missing");
    const entry = seen.get(row.stock);
    if (index < cursor.nextQuery && (!entry || entry.firstQuery > index))
      throw new Error(
        "Checkpoint skips required own-query official stock coverage",
      );
  }
}

/** Native model matching overlaps. An agreeing repeat supplies coverage only;
 * each exact table pair must still return every one of its own official stocks.
 */
function applySearch(
  context: JolietContext,
  pair: JolietPair,
  index: number,
  records: readonly JolietRecord[],
  seen: Map<string, JolietSeen>,
  vins: Map<string, string>,
) {
  const rows = new Map(context.rows.map((row) => [row.stock, row]));
  const returned = new Set(records.map((record) => record.stock));
  for (const row of context.rows.filter(
    (row) => jolietPairKey(row) === jolietPairKey(pair),
  ))
    if (!returned.has(row.stock))
      throw new Error(
        "Native exact query omitted its own official stock " + row.stock,
      );
  const vehicles: JolietCanonicalVehicle[] = [];
  const observedVins: string[] = [];
  let excluded = 0,
    rejected = 0,
    newStocks = 0;
  for (const record of records) {
    const row = rows.get(record.stock);
    if (!row || row.year !== record.year)
      throw new Error(
        "Native search stock/year is outside the official active inventory: " +
          record.stock,
      );
    const nativeRow = vinplusOptionalText(record.vehicleRow);
    const date = vinplusSourceDate(record.dateAdded);
    const renderedDate = date
      ? date.slice(5, 7) + "." + date.slice(8, 10) + "." + date.slice(2, 4)
      : null;
    if (
      (row.row && nativeRow && row.row !== nativeRow) ||
      (row.sourceSetDate && renderedDate && row.sourceSetDate !== renderedDate)
    )
      throw new Error(
        "Native position or set date conflicts with official stock " +
          record.stock,
      );
    const hash = jolietHash(jolietRecordIdentity(record));
    const transformed = transformJolietRecord(record);
    const vin =
      transformed.status === "available"
        ? transformed.vehicle.vin
        : transformed.vin;
    const prior = seen.get(record.stock);
    if (prior) {
      if (
        prior.hash !== hash ||
        prior.vin !== vin ||
        prior.status !== transformed.status
      )
        throw new Error(
          "Repeated native stock changed its stable record or required identity: " +
            record.stock,
        );
      excluded++;
      continue;
    }
    const stockForVin = vin ? vins.get(vin) : undefined;
    if (stockForVin && stockForVin !== record.stock)
      throw new Error("Different native stocks reuse valid VIN/serial " + vin);
    if (vin) vins.set(vin, record.stock);
    if (transformed.status === "available") {
      seen.set(record.stock, {
        stock: record.stock,
        hash,
        firstQuery: index,
        status: "available",
        vin: transformed.vehicle.vin,
      });
      vehicles.push(transformed.vehicle);
    } else {
      seen.set(record.stock, {
        stock: record.stock,
        hash,
        firstQuery: index,
        status: "incomplete",
        vin,
      });
      rejected++;
      if (vin) observedVins.push(vin);
    }
    newStocks++;
  }
  return { vehicles, observedVins, excluded, rejected, newStocks };
}

export function streamJolietInventoryWithRequestGate<E, R>(
  options: JolietOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = JolietCursorSchema.safeParse(
      options.startCursor ?? JolietCursor.initial,
    );
    const maxPages = options.maxPages ?? 16;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* new JolietProviderError({
        operation: "checkpoint",
        cause: "Use a validated Joliet cursor and a query budget from 1 to 32",
      });
    const initial = parsed.data;
    const summary: JolietStreamResult = {
      source: "joliet",
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
    const context = yield* fetchJolietContext(gate);
    if (initial.phase === "queries")
      yield* validateJoliet("durable scope", () =>
        validateResume(initial, context),
      );
    const seen = new Map<string, JolietSeen>(
      (initial.phase === "queries" ? initial.seen : []).map((entry) => [
        entry.stock,
        entry,
      ]),
    );
    const vins = new Map<string, string>();
    for (const entry of seen.values())
      if (entry.vin) vins.set(entry.vin, entry.stock);
    const receipts: QueryCursor["receipts"] =
      initial.phase === "queries" ? [...initial.receipts] : [];
    let nextQuery = initial.phase === "queries" ? initial.nextQuery : 0;
    const vehicles: JolietCanonicalVehicle[] = [];
    const observedVins: string[] = [];
    let processed = 0,
      excluded = 0,
      rejected = 0;
    while (
      nextQuery < context.pairs.length &&
      summary.pagesProcessed < maxPages
    ) {
      const pair = context.pairs[nextQuery];
      if (!pair)
        return yield* new JolietProviderError({
          operation: "query directory",
          cause: "Required native make/model pair is missing",
        });
      const response = yield* fetchJolietSearch(pair, gate);
      const result = yield* validateJoliet(
        "stock/year and own-query coverage",
        () =>
          applySearch(context, pair, nextQuery, response.records, seen, vins),
      );
      receipts.push({
        hash: response.hash,
        count: response.records.length,
        newStocks: result.newStocks,
      });
      vehicles.push(...result.vehicles);
      observedVins.push(...result.observedVins);
      processed += response.records.length;
      excluded += result.excluded;
      rejected += result.rejected;
      nextQuery++;
      summary.pagesProcessed++;
    }
    const terminal = nextQuery === context.pairs.length;
    if (terminal) {
      yield* validateJoliet("terminal coverage and quality", () => {
        if (
          seen.size !== context.rows.length ||
          context.rows.some((row) => !seen.has(row.stock))
        )
          throw new Error(
            "Terminal source stock union does not cover the complete official inventory",
          );
        const totalRejected = [...seen.values()].filter(
          (entry) => entry.status === "incomplete",
        ).length;
        if (
          totalRejected === seen.size ||
          totalRejected / seen.size >
            SourceValidationPolicy.maximumRejectionRatio
        )
          throw new Error(
            totalRejected +
              " rejected of " +
              seen.size +
              " active donors exceeds the unchanged 10% rejection limit or leaves no valid donors",
          );
      });
      const closing = yield* fetchJolietContext(gate);
      if (closing.hash !== context.hash)
        return yield* new JolietProviderError({
          operation: "terminal scope",
          cause:
            "Official owner, native table, public config or active counts changed during the crawl",
        });
    }
    const cursor = yield* validateJoliet("next checkpoint", () =>
      terminal
        ? JolietCursorSchema.parse({ source: "joliet", phase: "complete" })
        : JolietCursor.checkpoint({
            contextHash: context.hash,
            pairCount: context.pairs.length,
            nextQuery,
            seen: [...seen.values()],
            receipts,
          }),
    );
    // Reads and terminal closing scope pass before callbacks. Callback failures
    // cannot return an advanced durable checkpoint to the caller.
    yield* options.onBatch(vehicles);
    if (terminal && options.onYards) yield* options.onYards([JOLIET_YARD]);
    return {
      ...summary,
      status: terminal ? "complete" : "paused",
      cursor,
      count: vehicles.length,
      observedVins,
      warnings: rejected
        ? [
            "Joliet rejected incomplete required identities; valid rejected VINs supply presence evidence only.",
          ]
        : [],
      accounting: {
        recordsProcessed: processed,
        recordsExcluded: excluded,
        recordsRejected: rejected,
        duplicateVehicles: 0,
      },
    } satisfies JolietStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new JolietProviderError({
          operation: "query budget",
          cause:
            "Three-minute chunk limit exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}
export function streamJolietInventory<E, R>(options: JolietOptions<E, R>) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamJolietInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}

import { ingestionValidation } from "./ingestion-validation";
import { Effect, Option, RateLimiter } from "effect";
import {
  fetchLittletonContext,
  fetchLittletonSearch,
  LittletonProviderError,
  type LittletonContext,
} from "./littleton-client";
import {
  LittletonCursor,
  LittletonCursorSchema,
  type LittletonSeen,
} from "./littleton-cursor";
import { inventoryVin } from "./inventory-vin";
import {
  littletonHash,
  littletonPairKey,
  type LittletonPair,
  type LittletonRecord,
} from "./littleton-parser";
import {
  littletonRecordIdentity,
  transformLittletonRecord,
  type LittletonCanonicalVehicle,
} from "./littleton-transform";
import {
  LITTLETON_SEARCH_URL,
  LITTLETON_YARD,
  type LittletonYard,
} from "./littleton-yard-metadata";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import { ProviderChunkClock } from "./provider-chunk-clock";
import { sharedProviderHostTurn } from "./shared-provider-host";
import { SourceValidationPolicy } from "./source-validation";

/** Owner and inventory HTML plus VinPlus config and analytics. */
const CONTEXT_REQUESTS = 4;

interface LittletonOptions<E, R> {
  startCursor?: LittletonCursor;
  maxPages?: number;
  onBatch: (vehicles: LittletonCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: LittletonYard[]) => Effect.Effect<void, E, R>;
}
export type LittletonStreamResult = ConnectorChunkResult<
  "littleton",
  LittletonCursor
>;
type QueryCursor = Extract<LittletonCursor, { phase: "queries" }>;
const validated = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new LittletonProviderError({ operation, cause }),
  });

function validateResume(cursor: QueryCursor, context: LittletonContext): void {
  if (
    cursor.contextHash !== context.hash ||
    cursor.pairCount !== context.pairs.length
  )
    throw new Error(
      "Official table, public config or native counts changed during the crawl",
    );
  const rows = new Map(context.rows.map((r) => [r.stock, r]));
  const seen = new Map(cursor.seen.map((r) => [r.stock, r]));
  for (const entry of cursor.seen) {
    const row = rows.get(entry.stock);
    if (
      !row ||
      (entry.vin && inventoryVin(entry.vin, String(row.year)) !== entry.vin)
    )
      throw new Error(
        "Checkpoint stock/year or VIN/serial identity does not bind to the current official table",
      );
  }
  const pairIndexes = new Map(
    context.pairs.map((pair, index) => [littletonPairKey(pair), index]),
  );
  for (const row of context.rows) {
    const index = pairIndexes.get(littletonPairKey(row));
    if (index === undefined)
      throw new Error(
        "Checkpoint query index is outside the current native directory",
      );
    if (index < cursor.nextQuery) {
      const entry = seen.get(row.stock);
      if (!entry || entry.firstQuery > index)
        throw new Error("Checkpoint skips required own-query stock coverage");
    }
  }
}

/** Fuzzy native searches overlap. A repeated hit is coverage only if its
 * stable native record agrees, and every query proves all of its own table stocks.
 */
function applySearch(
  context: LittletonContext,
  pair: LittletonPair,
  index: number,
  records: readonly LittletonRecord[],
  seen: Map<string, LittletonSeen>,
  vins: Map<string, string>,
) {
  const rows = new Map(context.rows.map((r) => [r.stock, r]));
  const returned = new Set(records.map((r) => r.stock));
  for (const row of context.rows.filter(
    (r) => littletonPairKey(r) === littletonPairKey(pair),
  ))
    if (!returned.has(row.stock))
      throw new Error(
        "Native exact make/model query omitted its own official stock " +
          row.stock,
      );
  const vehicles: LittletonCanonicalVehicle[] = [];
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
    const identity = littletonRecordIdentity(record);
    if (
      (row.row && identity.row && row.row !== identity.row) ||
      (row.date && identity.date && row.date !== identity.date)
    )
      throw new Error(
        "Native position or set date conflicts with official stock " +
          record.stock,
      );
    const hash = littletonHash(identity);
    const transformed = transformLittletonRecord(record);
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
          "Repeated native stock changed its record or required identity: " +
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

export function streamLittletonInventoryWithRequestGate<E, R>(
  options: LittletonOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = LittletonCursorSchema.safeParse(
      options.startCursor ?? LittletonCursor.initial,
    );
    const maxPages = options.maxPages ?? 16;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* new LittletonProviderError({
        operation: "checkpoint",
        cause:
          "Use a validated Littleton cursor and a query budget from 1 to 32",
      });
    const initial = parsed.data;
    const summary: LittletonStreamResult = {
      source: "littleton",
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
    const resumeQuery = initial.phase === "queries" ? initial.nextQuery : 0;
    // One VinPlus turn reads the context, the query this chunk resumes at, and
    // the closing context when that query is the last, so a chunk needs one
    // turn to advance. Nothing here touches chunk state.
    const opening = yield* Effect.gen(function* () {
      const context = yield* fetchLittletonContext(gate);
      if (initial.phase === "queries")
        yield* validated("durable scope", () =>
          validateResume(initial, context),
        );
      const pair = context.pairs[resumeQuery];
      const search = pair ? yield* fetchLittletonSearch(pair, gate) : null;
      const closing =
        (pair ? resumeQuery + 1 : resumeQuery) >= context.pairs.length
          ? yield* fetchLittletonContext(gate)
          : null;
      return { context, search, closing };
    }).pipe(
      sharedProviderHostTurn(
        LITTLETON_SEARCH_URL,
        initial.phase === "queries" && resumeQuery === initial.pairCount - 1
          ? 2 * CONTEXT_REQUESTS + 1
          : CONTEXT_REQUESTS + 1,
      ),
    );
    const { context } = opening;
    const seen = new Map<string, LittletonSeen>(
      (initial.phase === "queries" ? initial.seen : []).map((r) => [
        r.stock,
        r,
      ]),
    );
    const vins = new Map<string, string>();
    for (const entry of seen.values())
      if (entry.vin) vins.set(entry.vin, entry.stock);
    const receipts: QueryCursor["receipts"] =
      initial.phase === "queries" ? [...initial.receipts] : [];
    let nextQuery = resumeQuery;
    const vehicles: LittletonCanonicalVehicle[] = [];
    const observedVins: string[] = [];
    let processed = 0,
      excluded = 0,
      rejected = 0;
    let pending =
      opening.search === null
        ? null
        : { response: opening.search, closing: opening.closing };
    let closing = opening.search === null ? opening.closing : null;
    while (
      nextQuery < context.pairs.length &&
      summary.pagesProcessed < maxPages
    ) {
      const pair = context.pairs[nextQuery];
      if (!pair)
        return yield* new LittletonProviderError({
          operation: "query directory",
          cause: "Required native make/model pair is missing",
        });
      if (pending === null) {
        const last = nextQuery === context.pairs.length - 1;
        // The last query shares its turn with the closing context, because
        // the cursor cannot hold a crawl whose closing context is pending.
        const read = yield* Effect.gen(function* () {
          const response = yield* fetchLittletonSearch(pair, gate);
          return {
            response,
            closing: last ? yield* fetchLittletonContext(gate) : null,
          };
        }).pipe(
          sharedProviderHostTurn(
            LITTLETON_SEARCH_URL,
            last ? CONTEXT_REQUESTS + 1 : 1,
          ),
          ProviderChunkClock.unlessDeferred(summary.pagesProcessed > 0),
        );
        if (Option.isNone(read)) break;
        pending = read.value;
      }
      const { response } = pending;
      closing = pending.closing;
      pending = null;
      const result = yield* validated(
        "stock/year and exact-query coverage",
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
      yield* validated("terminal inventory coverage and quality", () => {
        if (
          seen.size !== context.rows.length ||
          context.rows.some((r) => !seen.has(r.stock))
        )
          throw new Error(
            "Terminal source stock union does not cover the complete official inventory",
          );
        const totalRejected = [...seen.values()].filter(
          (r) => r.status === "incomplete",
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
      if (closing === null)
        return yield* new LittletonProviderError({
          operation: "terminal scope",
          cause: "The last native query was read without its closing context",
        });
      if (closing.hash !== context.hash)
        return yield* new LittletonProviderError({
          operation: "terminal scope",
          cause:
            "Official table, public config or native counts changed during the crawl",
        });
    }
    const cursor = yield* validated("next checkpoint", () =>
      terminal
        ? LittletonCursorSchema.parse({
            source: "littleton",
            phase: "complete",
          })
        : LittletonCursor.checkpoint({
            contextHash: context.hash,
            pairCount: context.pairs.length,
            nextQuery,
            seen: [...seen.values()],
            receipts,
          }),
    );
    // All chunk reads and the terminal closing scope pass before callbacks.
    // A failing callback cannot return an advanced durable checkpoint.
    yield* options.onBatch(vehicles);
    if (terminal && options.onYards) yield* options.onYards([LITTLETON_YARD]);
    return {
      ...summary,
      status: terminal ? "complete" : "paused",
      cursor,
      count: vehicles.length,
      observedVins,
      warnings: rejected
        ? [
            "Littleton rejected incomplete required identities; valid rejected VINs supply presence evidence only.",
          ]
        : [],
      accounting: {
        recordsProcessed: processed,
        recordsExcluded: excluded,
        recordsRejected: rejected,
        duplicateVehicles: 0,
      },
    } satisfies LittletonStreamResult;
  }).pipe(
    ProviderChunkClock.deadline({
      duration: "3 minutes",
      onTimeout: () =>
        new LittletonProviderError({
          operation: "query budget",
          cause:
            "Three-minute chunk limit exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}
export function streamLittletonInventory<E, R>(
  options: LittletonOptions<E, R>,
) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamLittletonInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}

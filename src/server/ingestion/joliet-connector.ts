import { Effect, Option, RateLimiter } from "effect";
import {
  fetchJolietContext,
  fetchJolietSearch,
  JolietProviderError,
  validateJoliet,
  type JolietContext,
} from "./joliet-client";
import {
  JOLIET_MAX_RESTARTS,
  JolietCursor,
  JolietCursorSchema,
  type JolietSeen,
} from "./joliet-cursor";
import { inventoryVin } from "./inventory-vin";
import {
  jolietHash,
  jolietYearCounts,
  JOLIET_MAX_DISAGREEMENT_RATIO,
  type JolietRecord,
} from "./joliet-parser";
import {
  jolietRecordIdentity,
  transformJolietRecord,
  type JolietCanonicalVehicle,
} from "./joliet-transform";
import {
  JOLIET_SEARCH_URL,
  JOLIET_YARD,
  type JolietYard,
} from "./joliet-yard-metadata";
import { vinplusOptionalText, vinplusSourceDate } from "./vinplus-protocol";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";
import { ProviderChunkClock } from "./provider-chunk-clock";
import { sharedProviderHostTurn } from "./shared-provider-host";

/** Owner, contact and inventory HTML plus VinPlus config and analytics. */
const CONTEXT_REQUESTS = 5;

interface JolietOptions<E, R> {
  startCursor?: JolietCursor;
  maxPages?: number;
  onBatch: (vehicles: JolietCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: JolietYard[]) => Effect.Effect<void, E, R>;
}
export type JolietStreamResult = ConnectorChunkResult<"joliet", JolietCursor>;
type QueryCursor = Extract<JolietCursor, { phase: "queries" }>;

const CONTEXT_CHANGED =
  "Official Joliet owner, native table, public config or active counts changed during the crawl";
const RESTARTED =
  "Joliet restarted the crawl from its first query because the official owner, native table, public config or active counts changed; earlier chunks of this run are superseded.";

/** Throws once a run has used every restart, so a source that keeps changing
 * still fails instead of crawling forever. */
function requireRestart(restarts: number): void {
  if (restarts >= JOLIET_MAX_RESTARTS)
    throw new Error(
      CONTEXT_CHANGED + " after " + JOLIET_MAX_RESTARTS + " restarts",
    );
}

/** The overnight publish replaces the official table and counts. A crawl it
 * overtakes starts over under the new context; one that did not must still
 * bind every checkpointed stock to the current table. */
function resumeOrRestart(
  cursor: QueryCursor,
  context: JolietContext,
): "resume" | "restart" {
  if (
    cursor.contextHash !== context.hash ||
    cursor.pairCount !== context.pairs.length
  ) {
    requireRestart(cursor.restarts ?? 0);
    return "restart";
  }
  const rows = new Map(context.rows.map((row) => [row.stock, row]));
  for (const entry of cursor.seen) {
    const row = rows.get(entry.stock);
    if (
      (row && row.year !== entry.year) ||
      (entry.vin && inventoryVin(entry.vin, String(entry.year)) !== entry.vin)
    )
      throw new Error(
        "Checkpoint stock/year or VIN/serial does not bind to the current official Joliet table",
      );
  }
  return "resume";
}

/** Native model matching overlaps. An agreeing repeat supplies coverage only;
 * missing HTML stocks are reconciled against the complete API union at terminal.
 */
function applySearch(
  context: JolietContext,
  index: number,
  records: readonly JolietRecord[],
  seen: Map<string, JolietSeen>,
  vins: Map<string, string>,
) {
  const rows = new Map(context.rows.map((row) => [row.stock, row]));
  const vehicles: JolietCanonicalVehicle[] = [];
  const observedVins: string[] = [];
  const apiOnlyStocks: string[] = [];
  let excluded = 0,
    rejected = 0,
    newStocks = 0;
  for (const record of records) {
    const row = rows.get(record.stock);
    if (row && row.year !== record.year)
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
      (row?.row && nativeRow && row.row !== nativeRow) ||
      (row?.sourceSetDate && renderedDate && row.sourceSetDate !== renderedDate)
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
        year: record.year,
        hash,
        firstQuery: index,
        status: "available",
        vin: transformed.vehicle.vin,
      });
      if (row) vehicles.push(transformed.vehicle);
    } else {
      seen.set(record.stock, {
        stock: record.stock,
        year: record.year,
        hash,
        firstQuery: index,
        status: "incomplete",
        vin,
      });
      if (row) {
        rejected++;
        if (vin) observedVins.push(vin);
      }
    }
    if (!row) {
      excluded++;
      apiOnlyStocks.push(record.stock);
    }
    newStocks++;
  }
  return {
    vehicles,
    observedVins,
    excluded,
    rejected,
    newStocks,
    apiOnlyStocks,
  };
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
    const resumeQuery = initial.phase === "queries" ? initial.nextQuery : 0;
    // One VinPlus turn reads the context, the query this chunk resumes at, and
    // the closing context when that query is the last, so a chunk needs one
    // turn to advance. Nothing here touches chunk state.
    const opening = yield* Effect.gen(function* () {
      const context = yield* fetchJolietContext(gate);
      const restart =
        initial.phase === "queries" &&
        (yield* validateJoliet("durable scope", () =>
          resumeOrRestart(initial, context),
        )) === "restart";
      // A restart searches the new context's first pair under that context.
      const start = restart ? 0 : resumeQuery;
      const pair = context.pairs[start];
      const search = pair ? yield* fetchJolietSearch(pair, gate) : null;
      const closing =
        (pair ? start + 1 : start) >= context.pairs.length
          ? yield* fetchJolietContext(gate)
          : null;
      return { context, search, closing, restart };
    }).pipe(
      sharedProviderHostTurn(
        JOLIET_SEARCH_URL,
        initial.phase === "queries" && resumeQuery === initial.pairCount - 1
          ? 2 * CONTEXT_REQUESTS + 1
          : CONTEXT_REQUESTS + 1,
      ),
    );
    const { context, restart } = opening;
    const restarts =
      (initial.phase === "start" ? 0 : (initial.restarts ?? 0)) +
      (restart ? 1 : 0);
    // A restart discards all progress made under the superseded context.
    const resumed = initial.phase === "queries" && !restart ? initial : null;
    const seen = new Map<string, JolietSeen>(
      (resumed?.seen ?? []).map((entry) => [entry.stock, entry]),
    );
    const vins = new Map<string, string>();
    for (const entry of seen.values())
      if (entry.vin) vins.set(entry.vin, entry.stock);
    const receipts: QueryCursor["receipts"] = [...(resumed?.receipts ?? [])];
    let nextQuery = resumed?.nextQuery ?? 0;
    const vehicles: JolietCanonicalVehicle[] = [];
    const observedVins: string[] = [];
    const warnings: string[] = [];
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
        return yield* new JolietProviderError({
          operation: "query directory",
          cause: "Required native make/model pair is missing",
        });
      if (pending === null) {
        const last = nextQuery === context.pairs.length - 1;
        // The last query shares its turn with the closing context, because
        // the cursor cannot hold a crawl whose closing context is pending.
        const read = yield* Effect.gen(function* () {
          const response = yield* fetchJolietSearch(pair, gate);
          return {
            response,
            closing: last ? yield* fetchJolietContext(gate) : null,
          };
        }).pipe(
          sharedProviderHostTurn(
            JOLIET_SEARCH_URL,
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
      const result = yield* validateJoliet(
        "stock/year and stable identity",
        () => applySearch(context, nextQuery, response.records, seen, vins),
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
      if (result.apiOnlyStocks.length)
        warnings.push(
          "Joliet excluded API-only stocks absent from HTML: " +
            result.apiOnlyStocks.join(", "),
        );
      nextQuery++;
      summary.pagesProcessed++;
    }
    const terminal = nextQuery === context.pairs.length;
    if (terminal) {
      if (closing === null)
        return yield* new JolietProviderError({
          operation: "terminal scope",
          cause: "The last native query was read without its closing context",
        });
      if (closing.hash !== context.hash) {
        // The crawl cannot prove the closing inventory, so nothing it read is
        // published. The next chunk crawls the new context from query 0.
        const cursor = yield* validateJoliet("terminal scope", () => {
          requireRestart(restarts);
          return JolietCursorSchema.parse({
            source: "joliet",
            phase: "restart",
            restarts: restarts + 1,
          });
        });
        return {
          ...summary,
          cursor,
          restart: true,
          warnings: [RESTARTED],
        } satisfies JolietStreamResult;
      }
      yield* validateJoliet("terminal coverage and quality", () => {
        const rows = new Set(context.rows.map((row) => row.stock));
        const htmlOnly = context.rows
          .filter((row) => !seen.has(row.stock))
          .map((row) => row.stock);
        const apiOnly = [...seen.keys()].filter((stock) => !rows.has(stock));
        if (
          (htmlOnly.length + apiOnly.length) / context.rows.length >
          JOLIET_MAX_DISAGREEMENT_RATIO
        )
          throw new Error(
            "Stocks exceed the 5% disagreement limit; HTML-only: " +
              htmlOnly.join(", ") +
              "; API-only: " +
              apiOnly.join(", "),
          );
        if (
          JSON.stringify(jolietYearCounts(seen.values())) !==
          JSON.stringify(context.counts)
        )
          throw new Error(
            "Terminal API stock union does not reconcile with native active inventory counts and years",
          );
        if (htmlOnly.length) {
          processed += htmlOnly.length;
          excluded += htmlOnly.length;
          warnings.push(
            "Joliet excluded HTML-only stocks absent from API: " +
              htmlOnly.join(", "),
          );
        }
        const shared = [...seen.values()].filter((entry) =>
          rows.has(entry.stock),
        );
        const totalRejected = shared.filter(
          (entry) => entry.status === "incomplete",
        ).length;
        if (
          totalRejected === shared.length ||
          totalRejected / shared.length >
            SourceValidationPolicy.maximumRejectionRatio
        )
          throw new Error(
            totalRejected +
              " rejected of " +
              shared.length +
              " active donors exceeds the unchanged 10% rejection limit or leaves no valid donors",
          );
      });
    }
    const cursor = yield* validateJoliet("next checkpoint", () =>
      terminal
        ? JolietCursorSchema.parse({
            source: "joliet",
            phase: "complete",
            ...(restarts ? { restarts } : {}),
          })
        : JolietCursor.checkpoint({
            contextHash: context.hash,
            restarts,
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
      ...(restart ? { restart: true } : {}),
      count: vehicles.length,
      observedVins,
      warnings: [
        ...(restart ? [RESTARTED] : []),
        ...warnings,
        ...(rejected
          ? [
              "Joliet rejected incomplete required identities; valid rejected VINs supply presence evidence only.",
            ]
          : []),
      ],
      accounting: {
        recordsProcessed: processed,
        recordsExcluded: excluded,
        recordsRejected: rejected,
        duplicateVehicles: 0,
      },
    } satisfies JolietStreamResult;
  }).pipe(
    ProviderChunkClock.deadline({
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

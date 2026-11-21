import { ingestionValidation } from "./ingestion-validation";
import { Effect } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import {
  fetchBigdPage,
  BigdProviderError,
  acquireBigdBrowser,
  bigdRequestGate,
  type BigdSession,
} from "./bigd-client";
import {
  BigdCursor,
  BigdCursorSchema,
  bigdHash,
  type BigdProgress,
} from "./bigd-cursor";
import { parseBigdInventory, parseBigdYard } from "./bigd-parser";
import { bigdSnapshot, type BigdVehicle } from "./bigd-snapshot";
import { BIGD_YARD, type BigdYard } from "./bigd-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";
import type { DocumentTransport } from "./document-transport";
import { Config } from "./context";

interface BigdOptions<E, R> {
  startCursor?: BigdCursor;
  maxPages?: number;
  previousAcceptedCount?: number | null;
  onBatch: (vehicles: BigdVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: BigdYard[]) => Effect.Effect<void, E, R>;
}
export type BigdStreamResult = ConnectorChunkResult<"bigd", BigdCursor>;
const attempt = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new BigdProviderError({ operation, cause }),
  });
export function streamBigdInventoryWithRequestGate<E, R>(
  options: BigdOptions<E, R>,
  gate: ProviderRequestGate,
  transport?: DocumentTransport,
): Effect.Effect<BigdStreamResult, E | BigdProviderError, R> {
  return Effect.gen(function* () {
    let cursor = yield* attempt("checkpoint", () =>
      BigdCursorSchema.parse(options.startCursor ?? BigdCursor.initial),
    );
    const budget = options.maxPages ?? 4;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 4)
      return yield* new BigdProviderError({
        operation: "chunk budget",
        cause:
          "Use 1-4 native evidence pages per chunk, plus one session bootstrap",
      });
    const empty = {
      count: 0,
      observedVins: [],
      accounting: {
        recordsProcessed: 0,
        recordsExcluded: 0,
        recordsRejected: 0,
        duplicateVehicles: 0,
      },
      errors: [],
      warnings: [],
    };
    let pagesProcessed = 0;
    if (cursor.phase === "complete")
      return {
        ...empty,
        source: "bigd",
        status: "complete",
        cursor,
        pagesProcessed,
      } satisfies BigdStreamResult;
    const session: BigdSession = { cookie: null };
    // One bounded public session bootstrap per chunk, with no automatic retry.
    // Its 403 challenge may supply a cookie but is never inventory evidence.
    yield* fetchBigdPage("/", session, gate, transport);
    while (pagesProcessed < budget) {
      const current: BigdProgress = cursor;
      const path =
        current.phase === "owner" || current.phase === "closing-owner"
          ? "/contact/"
          : "/inventory/";
      const body = yield* fetchBigdPage(path, session, gate, transport);
      pagesProcessed++;
      if (current.phase === "closing") {
        yield* attempt("closing table", () => {
          if (bigdHash(parseBigdInventory(body)) !== bigdHash(current.records))
            throw new Error(
              "Big D closing table changed identity, membership, order or optional metadata; restart from the initial cursor",
            );
        });
        const snapshot = yield* attempt("complete census quality", () =>
          bigdSnapshot(current.records, options.previousAcceptedCount ?? null),
        );
        if (options.onYards) yield* options.onYards([{ ...BIGD_YARD }]);
        yield* options.onBatch(snapshot.vehicles);
        return {
          ...empty,
          source: "bigd",
          status: "complete",
          cursor: { source: "bigd", version: 1, phase: "complete" },
          pagesProcessed,
          count: snapshot.vehicles.length,
          observedVins: snapshot.observedVins,
          accounting: snapshot.accounting,
        } satisfies BigdStreamResult;
      }
      cursor = yield* attempt("native " + current.phase, (): BigdProgress => {
        if (current.phase === "owner") {
          parseBigdYard(body);
          return BigdCursor.checkpoint({ ...current, phase: "catalog" });
        }
        if (current.phase === "catalog")
          return BigdCursor.checkpoint({
            ...current,
            phase: "closing-owner",
            records: parseBigdInventory(body),
          });
        parseBigdYard(body);
        return BigdCursor.checkpoint({ ...current, phase: "closing" });
      });
    }
    return {
      ...empty,
      source: "bigd",
      status: "paused",
      cursor,
      pagesProcessed,
    } satisfies BigdStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new BigdProviderError({
          operation: "chunk deadline",
          cause: "Three-minute request/body budget exceeded",
        }),
    }),
  );
}
/** One browser session per chunk, stopped when the chunk ends. */
export function streamBigdInventory<E, R>(options: BigdOptions<E, R>) {
  if (options.startCursor?.phase === "complete")
    return streamBigdInventoryWithRequestGate(options, bigdRequestGate);
  return Effect.scoped(
    Effect.gen(function* () {
      const config = yield* Config;
      const transport = yield* acquireBigdBrowser(config.hyperbrowserApiKey);
      return yield* streamBigdInventoryWithRequestGate(
        options,
        bigdRequestGate,
        transport,
      );
    }),
  );
}

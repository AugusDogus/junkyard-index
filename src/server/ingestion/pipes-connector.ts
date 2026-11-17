import { ingestionValidation } from "./ingestion-validation";
import { Effect } from "effect";
import {
  fetchPipesControl,
  PipesProviderError,
  type PipesControl,
} from "./pipes-client";
import {
  inspectPipesCursor,
  PipesCursor,
  PipesCursorSchema,
  pipesReceipt,
  PIPES_MAX_RUN_BYTES,
  PIPES_MAX_RUN_REQUESTS,
  type PipesCursorProgress,
  type PipesPhase,
} from "./pipes-cursor";
import {
  parsePipesInventory,
  pipesHash,
  pipesPairs,
  PIPES_MAX_RESPONSE_BYTES,
} from "./pipes-parser";
import { PIPES_YARD, type PipesYard } from "./pipes-yard-metadata";
import type { PipesCanonicalVehicle } from "./pipes-transform";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";

interface PipesOptions<E, R> {
  startCursor?: PipesCursor;
  maxPages?: number;
  onBatch: (vehicles: PipesCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: PipesYard[]) => Effect.Effect<void, E, R>;
}
export type PipesStreamResult = ConnectorChunkResult<"pipes", PipesCursor>;
const validated = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new PipesProviderError({ operation, cause }),
  });
const phases: readonly PipesPhase[] = [
  "opening",
  "native",
  "enrichment",
  "closing-native",
  "bookends",
  "closing-context",
  "complete",
];
function nextControl(cursor: PipesCursor): PipesControl | null {
  const { makes, pairs } = inspectPipesCursor(cursor);
  switch (cursor.phase) {
    case "opening":
      return { kind: "context", index: cursor.opening.length };
    case "native": {
      const make = makes[cursor.native.length];
      if (!make)
        throw new Error("Missing next native make in the validated directory");
      return { kind: "native", make };
    }
    case "enrichment": {
      const pair = pairs[cursor.queries.length];
      if (!pair)
        throw new Error(
          "Missing next literal query in the validated native census",
        );
      return { kind: "query", pair };
    }
    case "closing-native": {
      const make = makes[cursor.closingNative.length];
      if (!make)
        throw new Error(
          "Missing closing native make in the validated directory",
        );
      return { kind: "native", make };
    }
    case "bookends": {
      const pair = pairs[cursor.bookends.length === 0 ? 0 : pairs.length - 1];
      if (!pair) throw new Error("Missing exact first/last query bookend");
      return { kind: "query", pair };
    }
    case "closing-context":
      return { kind: "context", index: cursor.closingContext.length };
    case "complete":
      return null;
  }
}
function advance(
  cursor: PipesCursor,
  control: PipesControl,
  raw: string,
): PipesCursor {
  const progress: PipesCursorProgress = { ...cursor };
  const receipt = pipesReceipt(raw);
  switch (cursor.phase) {
    case "opening":
      progress.opening = [...cursor.opening, receipt];
      break;
    case "native": {
      if (control.kind !== "native")
        throw new Error("Unexpected native control");
      const page = parsePipesInventory(raw, control.make);
      const opening = inspectPipesCursor(cursor);
      if (pipesHash(page.makes) !== pipesHash(opening.makes))
        throw new Error(
          "Native make directory changed during the opening census",
        );
      progress.native = [
        ...cursor.native,
        {
          make: control.make,
          rows: page.rows,
          hash: pipesHash({ make: control.make, rows: page.rows }),
          bodyHash: receipt.bodyHash,
          bytes: receipt.bytes,
        },
      ];
      break;
    }
    case "enrichment":
      progress.queries = [...cursor.queries, receipt];
      break;
    case "closing-native": {
      if (control.kind !== "native")
        throw new Error("Unexpected closing native control");
      const page = parsePipesInventory(raw, control.make);
      if (pipesHash(page.makes) !== pipesHash(inspectPipesCursor(cursor).makes))
        throw new Error(
          "Native make directory changed during the closing census",
        );
      progress.closingNative = [
        ...cursor.closingNative,
        {
          hash: pipesHash({ make: control.make, rows: page.rows }),
          bodyHash: receipt.bodyHash,
          bytes: receipt.bytes,
        },
      ];
      break;
    }
    case "bookends":
      progress.bookends = [...cursor.bookends, receipt];
      break;
    case "closing-context":
      progress.closingContext = [...cursor.closingContext, receipt];
      break;
    case "complete":
      throw new Error(
        "Completed Pipes checkpoint cannot accept another control",
      );
  }
  const makes = progress.opening[1]
    ? parsePipesInventory(progress.opening[1].raw, null).makes.length
    : 0;
  // The directory is discovered from complete native pages. Empty stages are
  // crossed immediately, so every persisted phase has a remaining control.
  const pairCount = inspectPipesCursor(cursor).pairs.length;
  const lengths = [
    progress.opening.length,
    progress.native.length,
    progress.queries.length,
    progress.closingNative.length,
    progress.bookends.length,
    progress.closingContext.length,
  ];
  let phaseIndex = phases.indexOf(cursor.phase);
  const actualPairs =
    cursor.phase === "native" && progress.native.length === makes
      ? pipesPairs(progress.native.flatMap((page) => page.rows)).length
      : pairCount;
  const totals = [4, makes, actualPairs, makes, actualPairs ? 2 : 0, 4];
  while (phaseIndex < 6 && lengths[phaseIndex] === totals[phaseIndex])
    phaseIndex++;
  const phase = phases[phaseIndex];
  if (!phase)
    throw new Error("Pipes control advanced beyond the terminal phase");
  return PipesCursor.checkpoint({ ...progress, phase });
}

export function streamPipesInventoryWithRequestGate<E, R>(
  options: PipesOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const maxPages = options.maxPages ?? 8;
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 8)
      return yield* new PipesProviderError({
        operation: "request budget",
        cause: "Use an integer request budget from 1 to 8",
      });
    let cursor = yield* validated("checkpoint", () =>
      PipesCursorSchema.parse(options.startCursor ?? PipesCursor.initial),
    );
    const empty: PipesStreamResult = {
      source: "pipes",
      status: "paused",
      cursor,
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
    if (cursor.phase === "complete")
      return { ...empty, status: "complete" as const };
    const stopAt = Date.now() + 180_000;
    let pagesProcessed = 0;
    while (
      pagesProcessed < maxPages &&
      cursor.phase !== "complete" &&
      stopAt - Date.now() >= 25_000
    ) {
      yield* validated("remaining run capacity", () => {
        const used = inspectPipesCursor(cursor);
        if (
          used.requests >= PIPES_MAX_RUN_REQUESTS ||
          used.bytes > PIPES_MAX_RUN_BYTES - PIPES_MAX_RESPONSE_BYTES
        )
          throw new Error(
            "Run has no remaining request or full-response byte allowance; inspect source growth before retrying",
          );
      });
      const control = yield* validated("next control", () =>
        nextControl(cursor),
      );
      if (!control) break;
      const raw = yield* fetchPipesControl(control, gate);
      cursor = yield* validated("complete control prefix", () =>
        advance(cursor, control, raw),
      );
      pagesProcessed++;
    }
    if (cursor.phase !== "complete" && pagesProcessed === 0)
      return yield* new PipesProviderError({
        operation: "chunk progress",
        cause:
          "No control completed before the remaining chunk budget fell below 25 seconds; retry from the last validated checkpoint",
      });
    if (cursor.phase !== "complete")
      return { ...empty, cursor, pagesProcessed };
    const result = yield* validated(
      "terminal classification",
      () => inspectPipesCursor(cursor).classified,
    );
    const terminal: PipesStreamResult = {
      ...empty,
      status: "complete" as const,
      cursor,
      pagesProcessed,
      count: result.vehicles.length,
      observedVins: result.observedVins,
      warnings: result.rejected
        ? [
            "Pipes rejected incomplete required identities and quarantined any API-only stocks. Genuine rejected identities supply presence evidence only.",
          ]
        : [],
      accounting: {
        recordsProcessed: result.processed,
        recordsExcluded: 0,
        recordsRejected: result.rejected,
        duplicateVehicles: 0,
      },
    };
    // Capture terminal accounting before handing callbacks their own arrays.
    // Callback failure returns no advanced checkpoint for the caller to save.
    yield* options.onBatch([...result.vehicles]);
    if (options.onYards) yield* options.onYards([{ ...PIPES_YARD }]);
    return terminal;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new PipesProviderError({
          operation: "chunk deadline",
          cause:
            "Three-minute chunk limit exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}

export function streamPipesInventory<E, R>(options: PipesOptions<E, R>) {
  // Requests are sequential. Waiting after the entire body also preserves the
  // 1600 ms spacing across chunk boundaries, including failure/retry boundaries.
  const gate: ProviderRequestGate = (request) =>
    request.pipe(Effect.ensuring(Effect.sleep("1600 millis")));
  return streamPipesInventoryWithRequestGate(options, gate);
}

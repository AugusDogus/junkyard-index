import { ingestionValidation } from "./ingestion-validation";
import { Effect, Option } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import {
  JimsimportProviderError,
  readJimsimportPage,
} from "./jimsimport-client";
import {
  JimsimportCursor,
  jimsimportCensus,
  jimsimportCensusPlan,
  jimsimportClosingModels,
  jimsimportCoverageError,
  type JimsimportCensus,
} from "./jimsimport-cursor";
import {
  jimsimportDirectoryMembership,
  jimsimportHash,
  parseJimsimportDirectory,
  parseJimsimportModel,
  parseJimsimportOwner,
  type JimsimportMenu,
  type JimsimportPage,
} from "./jimsimport-parser";
import {
  jimsimportModels,
  jimsimportSnapshot,
  validateJimsimportSnapshot,
  type JimsimportVehicle,
} from "./jimsimport-transform";
import {
  JIMSIMPORT_CATALOG,
  JIMSIMPORT_ORIGIN,
  JIMSIMPORT_OWNER,
  JIMSIMPORT_MAX_BYTES,
  JIMSIMPORT_YARD,
  type JimsimportYard,
} from "./jimsimport-yard-metadata";
import { ModelCensus } from "./model-census";
import { ProviderChunkClock } from "./provider-chunk-clock";
import { sharedProviderHostTurn } from "./shared-provider-host";

export interface JimsimportOptions<E, R> {
  previousUniqueInventory: number | null;
  startCursor?: unknown;
  /** Terminal cursor of the last accepted, published run; read only when the
   * start cursor has not begun a census yet. */
  previousCursor?: unknown;
  now?: () => number;
  maxPages?: number;
  readPage: (url: string) => Effect.Effect<string, JimsimportProviderError>;
  onBatch: (vehicles: JimsimportVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: JimsimportYard[]) => Effect.Effect<void, E, R>;
}
export interface JimsimportStreamResult {
  source: "jimsimport";
  status: "paused" | "complete";
  cursor: JimsimportCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
const attempt = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new JimsimportProviderError(operation, cause),
  });
function stateOf<T extends { checksum: string }>(
  cursor: T,
): Omit<T, "checksum"> {
  const { checksum, ...state } = cursor;
  void checksum;
  return state;
}
/** Required donor fingerprint of a model page. Optional images may change to
 * null between reads without changing it. */
const requiredDonors = (page: JimsimportPage) =>
  jimsimportHash({
    ...page,
    records: page.records.map(({ image, ...required }) => {
      void image;
      return required;
    }),
  });
/** Appends carried pages up to the next due read. A complete model list must
 * cover today's badges and is validated as a whole snapshot (read and carried
 * pages) before closing. */
function openingPhase(
  state: {
    menus: readonly JimsimportMenu[];
    previous: JimsimportCensus | null;
    day: number | null;
  },
  read: readonly JimsimportPage[],
  previousUniqueInventory: number | null,
) {
  const opening = [
    ...read,
    ...ModelCensus.carriedRun(jimsimportCensusPlan(state), read.length),
  ];
  const complete = opening.length === jimsimportModels(state.menus).length;
  if (complete) {
    const shortfall = jimsimportCoverageError({
      menus: state.menus,
      opening,
      previous: state.previous,
    });
    if (shortfall) throw new Error(shortfall);
    validateJimsimportSnapshot(
      jimsimportSnapshot(state.menus, opening),
      previousUniqueInventory,
    );
  }
  return {
    phase: complete ? ("closing-makes" as const) : ("opening" as const),
    opening,
  };
}
export function streamJimsimportInventory<E, R>(
  options: JimsimportOptions<E, R>,
) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 8;
    if (
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 8 ||
      (options.previousUniqueInventory !== null &&
        (!Number.isSafeInteger(options.previousUniqueInventory) ||
          options.previousUniqueInventory < 0))
    )
      return yield* Effect.fail(
        new JimsimportProviderError(
          "run options",
          "Use a GET budget from 1 to 8 and a nonnegative previous complete count or null",
        ),
      );
    const start = yield* attempt("checkpoint", () =>
      JimsimportCursor.parse(options.startCursor ?? JimsimportCursor.initial()),
    );
    const now = options.now ?? Date.now;
    const begun = yield* attempt("begin census", () =>
      JimsimportCursor.begin(start, now(), options.previousCursor),
    );
    let cursor = begun.cursor;
    const summary: JimsimportStreamResult = {
      source: "jimsimport",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 0,
      errors: [],
      warnings: begun.warning ? [begun.warning] : [],
      observedVins: [],
      accounting: {
        recordsProcessed: 0,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      },
    };
    while (cursor.phase !== "complete" && summary.pagesProcessed < budget) {
      const current = cursor;
      if (
        current.requests >= 1024 ||
        current.bytes > 128 * 1024 * 1024 - JIMSIMPORT_MAX_BYTES
      )
        return yield* Effect.fail(
          new JimsimportProviderError(
            "whole-run budget",
            "Native graph remains incomplete at 1024 GETs or 128 MiB; retain the last validated checkpoint",
          ),
        );
      const context =
        current.phase === "opening"
          ? jimsimportModels(current.menus)[current.opening.length]
          : undefined;
      const make =
        current.phase === "models"
          ? current.makes[current.menus.length]
          : undefined;
      const closingModel =
        current.phase === "closing-models"
          ? jimsimportClosingModels(current)[current.closed]
          : undefined;
      const url =
        current.phase === "owner" || current.phase === "owner-closing"
          ? JIMSIMPORT_OWNER
          : current.phase === "makes" || current.phase === "closing-makes"
            ? JIMSIMPORT_CATALOG
            : make
              ? JIMSIMPORT_ORIGIN + make.path
              : context
                ? JIMSIMPORT_ORIGIN + context.model.path
                : closingModel
                  ? closingModel.url
                  : null;
      if (!url)
        return yield* Effect.fail(
          new JimsimportProviderError(
            "native frontier",
            "Missing exact next published directory or model destination",
          ),
        );
      // The terminal owner re-read is its own turn: the cursor holds
      // owner-closing, so a chunk resumed there completes with one turn.
      const page = yield* options
        .readPage(url)
        .pipe(
          sharedProviderHostTurn(url),
          ProviderChunkClock.unlessDeferred(summary.pagesProcessed > 0),
        );
      if (Option.isNone(page)) break;
      const raw = page.value;
      summary.pagesProcessed++;
      const counters = {
        requests: current.requests + 1,
        bytes: current.bytes + Buffer.byteLength(raw),
      };
      switch (current.phase) {
        case "owner":
          cursor = yield* attempt("physical owner", () =>
            JimsimportCursor.checkpoint({
              ...stateOf(current),
              ...counters,
              phase: "makes",
              ownerHash: parseJimsimportOwner(raw),
            }),
          );
          break;
        case "makes":
          cursor = yield* attempt("make directory", () =>
            JimsimportCursor.checkpoint({
              ...stateOf(current),
              ...counters,
              phase: "models",
              makes: parseJimsimportDirectory(raw),
              menus: [],
            }),
          );
          break;
        case "models":
          cursor = yield* attempt("model directory", () => {
            if (!make) throw new Error("Missing published make control");
            const menus = [
              ...current.menus,
              { make, models: parseJimsimportDirectory(raw, make) },
            ];
            // Carried models before the first due read cost no request.
            return menus.length === current.makes.length
              ? JimsimportCursor.checkpoint({
                  ...stateOf(current),
                  ...counters,
                  menus,
                  ...openingPhase(
                    { ...current, menus },
                    [],
                    options.previousUniqueInventory,
                  ),
                })
              : JimsimportCursor.checkpoint({
                  ...stateOf(current),
                  ...counters,
                  menus,
                });
          });
          break;
        case "opening":
          cursor = yield* attempt("opening model", () => {
            if (!context) throw new Error("Missing published model control");
            return JimsimportCursor.checkpoint({
              ...stateOf(current),
              ...counters,
              ...openingPhase(
                current,
                [
                  ...current.opening,
                  parseJimsimportModel(raw, context.make, context.model),
                ],
                options.previousUniqueInventory,
              ),
            });
          });
          break;
        case "closing-makes":
          // Closing re-reads the make directory, then each model read this
          // run whose cards differ from its badge or fall below its expected
          // count, then ownership.
          cursor = yield* attempt("closing make membership", () => {
            if (
              jimsimportHash(
                jimsimportDirectoryMembership(parseJimsimportDirectory(raw)),
              ) !== jimsimportHash(jimsimportDirectoryMembership(current.makes))
            )
              throw new Error(
                "Native make membership, labels, order or multiplicity changed",
              );
            return jimsimportClosingModels(current).length
              ? JimsimportCursor.checkpoint({
                  ...stateOf(current),
                  ...counters,
                  phase: "closing-models",
                  closed: 0,
                })
              : JimsimportCursor.checkpoint({
                  ...stateOf(current),
                  ...counters,
                  phase: "owner-closing",
                });
          });
          break;
        case "closing-models":
          cursor = yield* attempt("closing model donors", () => {
            if (!closingModel) throw new Error("Missing closing model control");
            const opened = current.opening[closingModel.index];
            const closing = parseJimsimportModel(
              raw,
              closingModel.make,
              closingModel.model,
            );
            if (!opened || requiredDonors(opened) !== requiredDonors(closing))
              throw new Error(
                `Native required donors on ${closingModel.model.path} changed during closing (opening ${opened?.records.length ?? "missing"} cards, closing ${closing.records.length}, badge ${closingModel.model.count}); its short opening page was not confirmed`,
              );
            const { closed, ...state } = stateOf(current);
            return closed + 1 === jimsimportClosingModels(current).length
              ? JimsimportCursor.checkpoint({
                  ...state,
                  ...counters,
                  phase: "owner-closing",
                })
              : JimsimportCursor.checkpoint({
                  ...state,
                  ...counters,
                  closed: closed + 1,
                });
          });
          break;
        case "owner-closing": {
          const closed = yield* attempt(
            "complete quality and ownership closure",
            () => {
              if (parseJimsimportOwner(raw) !== current.ownerHash)
                throw new Error(
                  "Native physical owner changed before emission",
                );
              const snapshot = jimsimportSnapshot(
                current.menus,
                current.opening,
              );
              validateJimsimportSnapshot(
                snapshot,
                options.previousUniqueInventory,
              );
              return { snapshot, census: jimsimportCensus(current) };
            },
          );
          const { snapshot } = closed;
          if (options.onYards) yield* options.onYards([{ ...JIMSIMPORT_YARD }]);
          yield* options.onBatch(snapshot.vehicles);
          summary.count = snapshot.vehicles.length;
          summary.accounting = snapshot.accounting;
          summary.observedVins = snapshot.observedVins;
          summary.warnings = [
            ...summary.warnings,
            "Native required rejects and connected VIN/destination conflicts are retained; directory badge counts are diagnostic and optional metadata is nullable.",
            "Jim's Import " +
              ModelCensus.summary(jimsimportCensusPlan(current)),
          ];
          cursor = JimsimportCursor.checkpoint({
            source: current.source,
            version: current.version,
            scope: current.scope,
            ...counters,
            phase: "complete",
            census: closed.census,
          });
          break;
        }
      }
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies JimsimportStreamResult;
  }).pipe(
    ProviderChunkClock.deadline({
      duration: "3 minutes",
      onTimeout: () =>
        new JimsimportProviderError(
          "chunk deadline",
          "Three-minute limit exceeded; retain the last validated checkpoint",
        ),
    }),
  );
}
export function streamJimsimportInventoryFromProvider<E, R>(
  options: Omit<JimsimportOptions<E, R>, "readPage">,
) {
  return streamJimsimportInventory({
    ...options,
    readPage: readJimsimportPage,
  });
}

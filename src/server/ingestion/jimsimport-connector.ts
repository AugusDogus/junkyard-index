import { ingestionValidation } from "./ingestion-validation";
import { Effect } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import {
  JimsimportProviderError,
  readJimsimportPage,
} from "./jimsimport-client";
import { JimsimportCursor } from "./jimsimport-cursor";
import {
  jimsimportDirectoryMembership,
  jimsimportHash,
  parseJimsimportDirectory,
  parseJimsimportModel,
  parseJimsimportOwner,
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
import { ProviderChunkClock } from "./provider-chunk-clock";

export interface JimsimportOptions<E, R> {
  previousUniqueInventory: number | null;
  startCursor?: unknown;
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
    let cursor = yield* attempt("checkpoint", () =>
      JimsimportCursor.parse(options.startCursor ?? JimsimportCursor.initial()),
    );
    const summary: JimsimportStreamResult = {
      source: "jimsimport",
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
    while (cursor.phase !== "complete" && summary.pagesProcessed < budget) {
      if (yield* ProviderChunkClock.shouldYield(summary.pagesProcessed)) break;
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
        current.phase === "opening" || current.phase === "closing"
          ? jimsimportModels(current.menus)[
              current.phase === "opening"
                ? current.opening.length
                : current.closing.length
            ]
          : undefined;
      const make =
        current.phase === "models"
          ? current.makes[current.menus.length]
          : current.phase === "closing-models"
            ? current.makes[current.closedMenus]
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
                : null;
      if (!url)
        return yield* Effect.fail(
          new JimsimportProviderError(
            "native frontier",
            "Missing exact next published directory or model destination",
          ),
        );
      const raw = yield* options.readPage(url);
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
            return menus.length === current.makes.length
              ? JimsimportCursor.checkpoint({
                  ...stateOf(current),
                  ...counters,
                  phase: "opening",
                  menus,
                  opening: [],
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
            const opening = [
              ...current.opening,
              parseJimsimportModel(raw, context.make, context.model),
            ];
            const complete =
              opening.length === jimsimportModels(current.menus).length;
            if (complete)
              validateJimsimportSnapshot(
                jimsimportSnapshot(current.menus, opening),
                options.previousUniqueInventory,
              );
            return JimsimportCursor.checkpoint({
              ...stateOf(current),
              ...counters,
              phase: complete ? "closing-makes" : "opening",
              opening,
            });
          });
          break;
        case "closing-makes":
          cursor = yield* attempt("closing make membership", () => {
            if (
              jimsimportHash(
                jimsimportDirectoryMembership(parseJimsimportDirectory(raw)),
              ) !== jimsimportHash(jimsimportDirectoryMembership(current.makes))
            )
              throw new Error(
                "Native make membership, labels, order or multiplicity changed",
              );
            return JimsimportCursor.checkpoint({
              ...stateOf(current),
              ...counters,
              phase: "closing-models",
              closedMenus: 0,
            });
          });
          break;
        case "closing-models":
          cursor = yield* attempt("closing model membership", () => {
            if (!make) throw new Error("Missing closing make control");
            const expected = current.menus[current.closedMenus];
            if (
              !expected ||
              jimsimportHash(
                jimsimportDirectoryMembership(
                  parseJimsimportDirectory(raw, make),
                ),
              ) !==
                jimsimportHash(jimsimportDirectoryMembership(expected.models))
            )
              throw new Error(
                "Native model membership, labels, order or multiplicity changed",
              );
            const { closedMenus, ...rest } = stateOf(current);
            return closedMenus + 1 === current.menus.length
              ? JimsimportCursor.checkpoint({
                  ...rest,
                  ...counters,
                  phase: "closing",
                  closing: [],
                })
              : JimsimportCursor.checkpoint({
                  ...rest,
                  ...counters,
                  phase: "closing-models",
                  closedMenus: closedMenus + 1,
                });
          });
          break;
        case "closing":
          cursor = yield* attempt("closing model", () => {
            if (!context) throw new Error("Missing closing model control");
            const closing = [
              ...current.closing,
              parseJimsimportModel(raw, context.make, context.model),
            ];
            return JimsimportCursor.checkpoint({
              ...stateOf(current),
              ...counters,
              phase:
                closing.length === current.opening.length
                  ? "owner-closing"
                  : "closing",
              closing,
            });
          });
          break;
        case "owner-closing": {
          const snapshot = yield* attempt(
            "complete quality and ownership closure",
            () => {
              if (parseJimsimportOwner(raw) !== current.ownerHash)
                throw new Error(
                  "Native physical owner changed before emission",
                );
              const opening = jimsimportSnapshot(
                  current.menus,
                  current.opening,
                ),
                closing = jimsimportSnapshot(current.menus, current.closing);
              validateJimsimportSnapshot(
                opening,
                options.previousUniqueInventory,
              );
              validateJimsimportSnapshot(
                closing,
                options.previousUniqueInventory,
              );
              const latest = new Map(closing.vehicles.map((v) => [v.vin, v]));
              for (const v of opening.vehicles)
                for (const key of ["stockNumber", "imageUrl"] as const)
                  if (v[key] !== latest.get(v.vin)?.[key]) v[key] = null;
              return opening;
            },
          );
          if (options.onYards) yield* options.onYards([{ ...JIMSIMPORT_YARD }]);
          yield* options.onBatch(snapshot.vehicles);
          summary.count = snapshot.vehicles.length;
          summary.accounting = snapshot.accounting;
          summary.observedVins = snapshot.observedVins;
          summary.warnings = [
            "Native required rejects and connected VIN/destination conflicts are retained; directory badge counts are diagnostic and optional metadata is nullable.",
          ];
          cursor = JimsimportCursor.checkpoint({
            source: current.source,
            version: current.version,
            scope: current.scope,
            ...counters,
            phase: "complete",
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

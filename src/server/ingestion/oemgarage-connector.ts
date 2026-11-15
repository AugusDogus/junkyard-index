import { Effect } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { OemgarageProviderError, readOemgaragePage } from "./oemgarage-client";
import { OemgarageCursor } from "./oemgarage-cursor";
import {
  oemgarageHash,
  parseOemgarageCatalog,
  parseOemgarageDetail,
  parseOemgarageOwner,
} from "./oemgarage-parser";
import {
  oemgarageSnapshot,
  validateOemgarageSnapshot,
  type OemgarageVehicle,
} from "./oemgarage-transform";
import {
  OEMGARAGE_CATALOG,
  OEMGARAGE_ORIGIN,
  OEMGARAGE_YARD,
  type OemgarageYard,
} from "./oemgarage-yard-metadata";

export interface OemgarageOptions<E, R> {
  previousUniqueInventory: number | null;
  startCursor?: unknown;
  maxPages?: number;
  readPage: (url: string) => Effect.Effect<string, OemgarageProviderError>;
  onBatch: (vehicles: OemgarageVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: OemgarageYard[]) => Effect.Effect<void, E, R>;
}
export interface OemgarageStreamResult {
  source: "oemgarage";
  status: "paused" | "complete";
  cursor: OemgarageCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
const attempt = <A>(operation: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => new OemgarageProviderError(operation, cause),
  });
function stateOf<T extends { checksum: string }>(
  cursor: T,
): Omit<T, "checksum"> {
  const { checksum, ...state } = cursor;
  void checksum;
  return state;
}
export function streamOemgarageInventory<E, R>(
  options: OemgarageOptions<E, R>,
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
        new OemgarageProviderError(
          "run options",
          "Use a GET budget from 1 to 8 and a nonnegative previous complete count or null",
        ),
      );
    let cursor = yield* attempt("checkpoint", () =>
      OemgarageCursor.parse(options.startCursor ?? OemgarageCursor.initial()),
    );
    const summary: OemgarageStreamResult = {
      source: "oemgarage",
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
      const current = cursor;
      const card =
        current.phase === "opening"
          ? current.catalog.cards[current.opening.length]
          : current.phase === "closing"
            ? current.catalog.cards[current.closing.length]
            : undefined;
      const url =
        current.phase === "owner" || current.phase === "owner-closing"
          ? OEMGARAGE_ORIGIN + "/"
          : current.phase === "catalog" || current.phase === "closing-catalog"
            ? OEMGARAGE_CATALOG
            : card?.url;
      if (!url)
        return yield* Effect.fail(
          new OemgarageProviderError(
            "native frontier",
            "Missing exact next donor destination",
          ),
        );
      const raw = yield* options.readPage(url);
      summary.pagesProcessed++;
      switch (current.phase) {
        case "owner":
          cursor = yield* attempt("physical owner", () =>
            OemgarageCursor.checkpoint({
              source: current.source,
              version: current.version,
              scope: current.scope,
              phase: "catalog",
              ownerHash: parseOemgarageOwner(raw),
            }),
          );
          break;
        case "catalog":
          cursor = yield* attempt("finite native donor catalog", () =>
            OemgarageCursor.checkpoint({
              ...stateOf(current),
              phase: "opening",
              catalog: parseOemgarageCatalog(raw),
              opening: [],
            }),
          );
          break;
        case "opening":
          cursor = yield* attempt("opening donor " + card?.id, () => {
            if (!card) throw new Error("Missing enumerated native donor");
            const opening = [
              ...current.opening,
              parseOemgarageDetail(raw, card),
            ];
            if (opening.length === current.catalog.cards.length)
              validateOemgarageSnapshot(
                oemgarageSnapshot(current.catalog, opening),
                options.previousUniqueInventory,
              );
            return OemgarageCursor.checkpoint({
              ...stateOf(current),
              phase:
                opening.length === current.catalog.cards.length
                  ? "closing-catalog"
                  : "opening",
              opening,
            });
          });
          break;
        case "closing-catalog":
          cursor = yield* attempt("closing native membership", () => {
            if (
              oemgarageHash(parseOemgarageCatalog(raw)) !==
              oemgarageHash(current.catalog)
            )
              throw new Error(
                "Native donor membership, required card claims, order or multiplicity changed",
              );
            return OemgarageCursor.checkpoint({
              ...stateOf(current),
              phase: "closing",
              closing: [],
            });
          });
          break;
        case "closing":
          cursor = yield* attempt("closing donor " + card?.id, () => {
            if (!card) throw new Error("Missing enumerated closing donor");
            const closing = [
              ...current.closing,
              parseOemgarageDetail(raw, card),
            ];
            return OemgarageCursor.checkpoint({
              ...stateOf(current),
              phase:
                closing.length === current.catalog.cards.length
                  ? "owner-closing"
                  : "closing",
              closing,
            });
          });
          break;
        case "owner-closing": {
          const snapshot = yield* attempt(
            "complete native quality and ownership closure",
            () => {
              if (parseOemgarageOwner(raw) !== current.ownerHash)
                throw new Error(
                  "Native physical owner changed before emission",
                );
              const opening = oemgarageSnapshot(
                  current.catalog,
                  current.opening,
                ),
                closing = oemgarageSnapshot(current.catalog, current.closing);
              validateOemgarageSnapshot(
                opening,
                options.previousUniqueInventory,
              );
              validateOemgarageSnapshot(
                closing,
                options.previousUniqueInventory,
              );
              const latest = new Map(closing.vehicles.map((v) => [v.vin, v]));
              for (const v of opening.vehicles) {
                const other = latest.get(v.vin);
                for (const key of [
                  "stockNumber",
                  "color",
                  "imageUrl",
                  "availableDate",
                  "engine",
                  "transmission",
                ] as const)
                  if (v[key] !== other?.[key]) v[key] = null;
              }
              return opening;
            },
          );
          if (options.onYards) yield* options.onYards([{ ...OEMGARAGE_YARD }]);
          yield* options.onBatch(snapshot.vehicles);
          summary.count = snapshot.vehicles.length;
          summary.observedVins = snapshot.observedVins;
          summary.accounting = snapshot.accounting;
          cursor = OemgarageCursor.checkpoint({
            source: current.source,
            version: current.version,
            scope: current.scope,
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
    } satisfies OemgarageStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new OemgarageProviderError(
          "chunk deadline",
          "Three-minute limit exceeded; retain the last validated checkpoint",
        ),
    }),
  );
}
export function streamOemgarageInventoryFromProvider<E, R>(
  options: Omit<OemgarageOptions<E, R>, "readPage">,
) {
  return streamOemgarageInventory({ ...options, readPage: readOemgaragePage });
}

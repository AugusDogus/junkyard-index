import { Effect, RateLimiter } from "effect";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  DutchersProviderError,
  dutchersValidated,
  fetchDutchersPage,
} from "./dutchers-client";
import { DutchersCursor, dutchersPageControl } from "./dutchers-cursor";
import { parseDutchersCatalog } from "./dutchers-parser";
import { parseDutchersScope, parseDutchersStore } from "./dutchers-scope";
import {
  dutchersRoster,
  dutchersSnapshot,
  type DutchersCanonicalVehicle,
} from "./dutchers-snapshot";
import {
  DUTCHERS_PAGE_SIZE,
  DUTCHERS_SCOPE,
  DUTCHERS_STORE,
  DUTCHERS_YARD,
  dutchersCatalogUrl,
} from "./dutchers-yard-metadata";

interface DutchersOptions<E, R> {
  startCursor?: DutchersCursor;
  maxPages?: number;
  onBatch: (vehicles: DutchersCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: (typeof DUTCHERS_YARD)[]) => Effect.Effect<void, E, R>;
  /** Saved public-response replay; production uses the bounded native client. */
  readPage?: (url: string) => Effect.Effect<string, DutchersProviderError>;
}
export function streamDutchersInventoryWithRequestGate<E, R>(
  options: DutchersOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 8;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 16)
      return yield* Effect.fail(
        new DutchersProviderError({
          operation: "request budget",
          cause: "Use 1-16 native GET units",
        }),
      );
    let cursor = yield* dutchersValidated("checkpoint", () =>
      DutchersCursor.parse(options.startCursor ?? DutchersCursor.initial()),
    );
    let pagesProcessed = 0;
    const readPage =
      options.readPage ?? ((url: string) => fetchDutchersPage(url, gate));
    const empty = {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    const observedVins: string[] = [],
      errors: string[] = [],
      warnings: string[] = [];
    const paused = () => ({
      source: "dutchers" as const,
      status:
        cursor.phase === "complete"
          ? ("complete" as const)
          : ("paused" as const),
      cursor,
      count: 0,
      pagesProcessed,
      accounting: empty,
      observedVins,
      errors,
      warnings,
    });
    if (cursor.phase === "complete") return paused();
    if (cursor.startedAt === 0)
      cursor = DutchersCursor.checkpoint({ ...cursor, startedAt: Date.now() });
    const started = Date.now();
    while (pagesProcessed < budget && Date.now() - started < 60_000) {
      const current = cursor;
      if (
        Date.now() < current.startedAt ||
        Date.now() - current.startedAt > 3_600_000
      )
        return yield* Effect.fail(
          new DutchersProviderError({
            operation: "run lifetime",
            cause:
              "Dutcher census exceeded its one-hour bound; restart the complete census",
          }),
        );
      switch (current.phase) {
        case "scope-opening": {
          const raw = yield* readPage(DUTCHERS_SCOPE);
          cursor = yield* dutchersValidated("native donor scope", () =>
            DutchersCursor.checkpoint({
              ...current,
              phase: "store-opening",
              scope: parseDutchersScope(raw),
            }),
          );
          break;
        }
        case "store-opening": {
          const raw = yield* readPage(DUTCHERS_STORE);
          cursor = yield* dutchersValidated("physical owner and total", () =>
            DutchersCursor.checkpoint({
              ...current,
              phase: "opening",
              total: parseDutchersStore(raw),
              pages: [],
            }),
          );
          break;
        }
        case "opening":
        case "closing": {
          const control = dutchersPageControl(
            current.total,
            current.pages.length,
          );
          const raw = yield* readPage(
            dutchersCatalogUrl(control.direction, control.page),
          );
          cursor = yield* dutchersValidated("dual-sort census", () => {
            const page = parseDutchersCatalog(
              raw,
              control.direction,
              control.page,
              current.total,
            );
            const pages = [...current.pages, page];
            const done =
              pages.length ===
              Math.ceil(current.total / DUTCHERS_PAGE_SIZE) * 2;
            if (current.phase === "opening")
              return DutchersCursor.checkpoint(
                done
                  ? { ...current, phase: "closing", opening: pages, pages: [] }
                  : { ...current, pages },
              );
            if (!done) return DutchersCursor.checkpoint({ ...current, pages });
            const { pages: _prior, ...rest } = current;
            void _prior;
            return DutchersCursor.checkpoint({
              ...rest,
              phase: "store-closing",
              closing: pages,
            });
          });
          break;
        }
        case "store-closing": {
          const raw = yield* readPage(DUTCHERS_STORE);
          cursor = yield* dutchersValidated("closing store total", () => {
            if (parseDutchersStore(raw) !== current.total)
              throw new Error(
                "Dutcher independent store total changed during census",
              );
            return DutchersCursor.checkpoint({
              ...current,
              phase: "scope-closing",
            });
          });
          break;
        }
        case "scope-closing": {
          const raw = yield* readPage(DUTCHERS_SCOPE);
          const snapshot = yield* dutchersValidated(
            "closing donor scope and quality",
            () => {
              if (
                parseDutchersScope(raw).fingerprint !==
                current.scope.fingerprint
              )
                throw new Error(
                  "Dutcher native parts or retail/rebuildable scope changed",
                );
              return dutchersSnapshot(
                dutchersRoster(current.opening, current.total),
                current.scope,
              );
            },
          );
          if (options.onYards) yield* options.onYards([DUTCHERS_YARD]);
          yield* options.onBatch(snapshot.vehicles);
          cursor = DutchersCursor.checkpoint({
            source: "dutchers",
            version: 1,
            scopeKey: current.scopeKey,
            startedAt: current.startedAt,
            phase: "complete",
          });
          return {
            ...paused(),
            status: "complete" as const,
            count: snapshot.vehicles.length,
            pagesProcessed: pagesProcessed + 1,
            observedVins: snapshot.observedVins,
            accounting: snapshot.accounting,
            warnings: snapshot.rejects.map(
              (r) =>
                `Dutcher item ${r.record.id}: ${r.reason}; valid rejected VINs retained as observed presence.`,
            ),
          };
        }
        case "complete":
          return paused();
      }
      pagesProcessed++;
    }
    return paused();
  }).pipe(
    Effect.timeoutFail({
      duration: "2 minutes",
      onTimeout: () =>
        new DutchersProviderError({
          operation: "chunk deadline",
          cause:
            "Two-minute chunk limit exceeded; no advanced checkpoint accepted",
        }),
    }),
  );
}
export function streamDutchersInventory<E, R>(options: DutchersOptions<E, R>) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "4 seconds" }).pipe(
      Effect.flatMap((gate) =>
        streamDutchersInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}

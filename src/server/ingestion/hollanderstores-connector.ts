import { Effect } from "effect";
import {
  fetchHollanderstoresPage,
  hollanderstoresAttempt,
  hollanderstoresSeed,
  HollanderstoresProviderError,
} from "./hollanderstores-client";
import {
  HollanderstoresCursor,
  hollanderstoresMissing,
  type HollanderstoresState,
} from "./hollanderstores-cursor";
import {
  parseHollanderstoresRoster,
  HollanderstoresPageSchema,
} from "./hollanderstores-parser";
import {
  hollanderstoresSnapshot,
  type HollanderstoresVehicle,
} from "./hollanderstores-snapshot";
import {
  HOLLANDERSTORES_YARDS,
  type HollanderstoresYard,
} from "./hollanderstores-yard-metadata";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { hollanderstoresCensusError } from "./hollanderstores-census";

export interface HollanderstoresOptions<E, R> {
  startCursor?: unknown;
  maxPages?: number;
  previousAcceptedCount?: number | null;
  readPage?: (
    yard: HollanderstoresYard,
    pageNumber: number,
  ) => Effect.Effect<string, HollanderstoresProviderError>;
  decodeBatch: (
    vins: readonly string[],
  ) => Effect.Effect<
    Record<string, string | null>,
    HollanderstoresProviderError
  >;
  loadKnownMakes?: (
    vins: readonly string[],
  ) => Effect.Effect<Record<string, string>, HollanderstoresProviderError>;
  onBatch: (vehicles: HollanderstoresVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: HollanderstoresYard[]) => Effect.Effect<void, E, R>;
}
export interface HollanderstoresStreamResult {
  source: "hollanderstores";
  status: "paused" | "complete" | "failed";
  cursor: HollanderstoresCursor;
  count: number;
  pagesProcessed: number;
  accounting: ConnectorChunkAccounting;
  observedVins: string[];
  errors: string[];
  warnings: string[];
}
export function streamHollanderstoresInventory<E, R>(
  options: HollanderstoresOptions<E, R>,
) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 1;
    let cursor = yield* hollanderstoresAttempt("resume checkpoint", () => {
      if (!Number.isSafeInteger(budget) || budget < 1 || budget > 8)
        throw new Error("Use a chunk request budget from 1 through 8");
      const value = HollanderstoresCursor.parse(
        options.startCursor ??
          HollanderstoresCursor.initial(options.previousAcceptedCount ?? null),
      );
      if (
        options.previousAcceptedCount !== undefined &&
        value.previousAcceptedCount !== options.previousAcceptedCount
      )
        throw new Error("Previous accepted count contradicts checkpoint");
      return value;
    });
    const empty: HollanderstoresStreamResult = {
      source: "hollanderstores",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 0,
      accounting: {
        recordsProcessed: 0,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      },
      observedVins: [],
      errors: [],
      warnings: [],
    };
    if (cursor.phase === "complete")
      return { ...empty, status: "complete" as const };
    let pagesProcessed = 0;
    while (cursor.phase !== "ready" && pagesProcessed < budget) {
      const current: HollanderstoresCursor = cursor;
      yield* hollanderstoresAttempt("run lifetime", () => {
        if (
          current.startedAt &&
          (Date.now() < current.startedAt ||
            Date.now() - current.startedAt > 2 * 60 * 60 * 1000)
        )
          throw new Error(
            "Two-hour census lifetime expired; restart after inspecting freshness",
          );
      });
      const common = {
        source: current.source,
        version: current.version,
        scope: current.scope,
        startedAt: current.startedAt || Date.now(),
        previousAcceptedCount: current.previousAcceptedCount,
        pages: current.pages,
        pending: current.pending,
        decoded: current.decoded,
        requests: current.requests + 1,
      };
      let next: HollanderstoresState | { phase: "failed"; error: string };
      if (current.phase === "decoding") {
        const needed = hollanderstoresMissing(current).slice(
          Object.keys(current.decoded).length,
          Object.keys(current.decoded).length + 50,
        );
        const decoded = yield* options.decodeBatch(needed);
        next = yield* hollanderstoresAttempt(
          "VIN batch membership",
          (): HollanderstoresState => {
            if (
              Object.keys(decoded).length !== needed.length ||
              needed.some((vin) => !Object.hasOwn(decoded, vin))
            )
              throw new Error(
                "VIN cache/decode returned missing or foreign identities",
              );
            const values: Record<string, string | null> = {
              ...current.decoded,
            };
            for (const vin of needed) {
              const make = decoded[vin];
              if (make === undefined)
                throw new Error(
                  "VIN decode returned undefined make for " + vin,
                );
              values[vin] = make;
            }
            return Object.keys(values).length ===
              hollanderstoresMissing(current).length
              ? { ...common, decoded: values, phase: "closing", closed: 0 }
              : { ...common, decoded: values, phase: "decoding" };
          },
        );
      } else {
        const index =
          current.phase === "opening" ? current.pages.length : current.closed;
        const yard = HOLLANDERSTORES_YARDS[index];
        if (!yard)
          return yield* Effect.fail(
            new HollanderstoresProviderError({
              operation: "yard traversal",
              cause: "Missing ordered yard",
            }),
          );
        const pageNumber = current.pending
          ? current.pending.rows.length / 20 + 1
          : 1;
        const raw = yield* options.readPage
          ? options.readPage(yard, pageNumber)
          : fetchHollanderstoresPage(yard, undefined, pageNumber);
        next = yield* hollanderstoresAttempt(
          "complete native card view " + yard.code,
          (): HollanderstoresState | { phase: "failed"; error: string } => {
            const slice = parseHollanderstoresRoster(raw, yard, pageNumber);
            if (current.pending && current.pending.total !== slice.total)
              throw new Error(
                "Hollander Stores published total changed between list pages",
              );
            const combined = {
              yard: yard.code,
              total: slice.total,
              rows: [...(current.pending?.rows ?? []), ...slice.rows],
            };
            if (
              new Set(combined.rows.map((row) => row.url)).size !==
              combined.rows.length
            )
              throw new Error(
                "Hollander Stores repeated a destination between list pages",
              );
            if (slice.nextPage !== null)
              return current.phase === "opening"
                ? { ...common, phase: "opening", pending: combined }
                : {
                    ...common,
                    phase: "closing",
                    closed: current.closed,
                    pending: combined,
                  };
            const page = HollanderstoresPageSchema.parse(combined);
            const completed = { ...common, pending: null };
            if (current.phase === "opening") {
              const pages = [...current.pages, page];
              if (pages.length < HOLLANDERSTORES_YARDS.length)
                return { ...completed, pages, phase: "opening" };
              return hollanderstoresMissing({ pages }).length
                ? { ...completed, pages, phase: "decoding" }
                : { ...completed, pages, phase: "closing", closed: 0 };
            }
            const opening = current.pages[index];
            if (!opening) throw new Error("Missing opening yard census");
            const error = hollanderstoresCensusError(opening, page);
            if (error) return { phase: "failed", error };
            const closed = index + 1;
            return closed === HOLLANDERSTORES_YARDS.length
              ? { ...completed, phase: "ready", closed }
              : { ...completed, phase: "closing", closed };
          },
        );
      }
      // A frozen opening cannot be repaired by re-POSTing the closing roster.
      // A failed result ends the durable source without workflow step retries.
      if (next.phase === "failed")
        return {
          ...empty,
          status: "failed" as const,
          failureKind: "validation" as const,
          cursor,
          pagesProcessed: pagesProcessed + 1,
          errors: [next.error],
        };
      cursor = yield* hollanderstoresAttempt(
        "checkpoint advance",
        (): HollanderstoresCursor => HollanderstoresCursor.checkpoint(next),
      );
      pagesProcessed++;
    }
    if (cursor.phase !== "ready") return { ...empty, cursor, pagesProcessed };
    const ready = cursor;
    yield* hollanderstoresAttempt("completed census lifetime", () => {
      if (
        Date.now() < ready.startedAt ||
        Date.now() - ready.startedAt > 2 * 60 * 60 * 1000
      )
        throw new Error(
          "Two-hour census lifetime expired; preserve inventory and restart after inspecting freshness",
        );
    });
    const known = options.loadKnownMakes
      ? yield* options.loadKnownMakes(
          ready.pages.flatMap((page) =>
            page.rows.filter((row) => row.make).map((row) => row.vin),
          ),
        )
      : {};
    const snapshot = yield* hollanderstoresAttempt(
      "whole-source and per-yard quality",
      () => {
        const value = hollanderstoresSnapshot(
          ready.pages,
          { ...hollanderstoresSeed, ...known, ...ready.decoded },
          ready.previousAcceptedCount,
        );
        if (value.errors.length) throw new Error(value.errors.join("; "));
        return value;
      },
    );
    if (options.onYards) yield* options.onYards([...HOLLANDERSTORES_YARDS]);
    yield* options.onBatch(snapshot.vehicles);
    cursor = yield* hollanderstoresAttempt("terminal checkpoint", () => {
      return HollanderstoresCursor.checkpoint({
        source: ready.source,
        version: ready.version,
        scope: ready.scope,
        startedAt: ready.startedAt,
        previousAcceptedCount: ready.previousAcceptedCount,
        pages: ready.pages,
        pending: null,
        decoded: ready.decoded,
        requests: ready.requests,
        phase: "complete",
        closed: ready.closed,
      });
    });
    return {
      ...empty,
      status: "complete" as const,
      cursor,
      pagesProcessed,
      count: snapshot.vehicles.length,
      accounting: snapshot.accounting,
      observedVins: snapshot.observedVins,
      warnings: snapshot.warnings,
    };
  }).pipe(
    Effect.timeoutFail({
      duration: "20 minutes",
      onTimeout: () =>
        new HollanderstoresProviderError({
          operation: "chunk deadline",
          cause:
            "Twenty-minute deadline exceeded; retain the previous checkpoint",
        }),
    }),
  );
}

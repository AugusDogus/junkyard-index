import { Effect } from "effect";
import { z } from "zod";
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
  hollanderstoresPreservedReason,
  hollanderstoresSnapshot,
  type HollanderstoresVehicle,
} from "./hollanderstores-snapshot";
import {
  HOLLANDERSTORES_YARDS,
  type HollanderstoresYard,
} from "./hollanderstores-yard-metadata";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { hollanderstoresCensusError } from "./hollanderstores-census";
import {
  HOLLANDERSTORES_MAX_REQUESTS,
  HOLLANDERSTORES_MAX_ROWS,
} from "./hollanderstores-limits";

const decodedMakes = z.record(
  z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/),
  z.string().trim().min(1).max(100).nullable(),
);

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
    const start = yield* hollanderstoresAttempt("resume checkpoint", () => {
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
      cursor: start,
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
    if (start.phase === "complete")
      return { ...empty, status: "complete" as const };
    // Only chunk boundaries are persisted. Keep typed, individually validated
    // HTTP/decode results in memory instead of cloning and hashing the entire
    // census after each of the chunk's (at most eight) requests.
    let cursor: HollanderstoresState = start;
    let missingVins: string[] | undefined;
    let pagesProcessed = 0;
    while (cursor.phase !== "ready" && pagesProcessed < budget) {
      const current: HollanderstoresState = cursor;
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
      let next: HollanderstoresState | { phase: "failed"; errors: string[] };
      if (current.phase === "decoding") {
        const missing = (missingVins ??= hollanderstoresMissing(current));
        const needed = missing.slice(
          Object.keys(current.decoded).length,
          Object.keys(current.decoded).length + 50,
        );
        const response = yield* options.decodeBatch(needed);
        const decoded = yield* hollanderstoresAttempt("VIN batch values", () =>
          decodedMakes.parse(response),
        );
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
            return Object.keys(values).length === missing.length
              ? { ...common, decoded: values, phase: "closing", closed: 0 }
              : { ...common, decoded: values, phase: "decoding" };
          },
        );
      } else {
        const index: number =
          current.phase === "opening" ? current.pages.length : current.closed;
        const yard: HollanderstoresYard | undefined =
          HOLLANDERSTORES_YARDS[index];
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
          (): HollanderstoresState | { phase: "failed"; errors: string[] } => {
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
                    ...(current.preserved && { preserved: current.preserved }),
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
            // A yard whose census drifted is preserved: it publishes nothing
            // this run and its previous inventory stays. The others publish.
            const error = hollanderstoresCensusError(opening, page);
            const preserved = [
              ...(current.phase === "closing" ? (current.preserved ?? []) : []),
              ...(error
                ? [
                    {
                      code: yard.code,
                      reason: hollanderstoresPreservedReason(error),
                    },
                  ]
                : []),
            ];
            const closed = index + 1;
            if (closed !== HOLLANDERSTORES_YARDS.length)
              return preserved.length
                ? { ...completed, phase: "closing", closed, preserved }
                : { ...completed, phase: "closing", closed };
            // With every yard drifted there is nothing to publish.
            if (preserved.length === HOLLANDERSTORES_YARDS.length)
              return {
                phase: "failed",
                errors: [
                  `Hollander Stores closing census drifted in all ${preserved.length} yards, so nothing publishes and all previously published inventory is preserved; a fresh crawl later today retries. First reasons follow.`,
                  ...preserved.slice(0, 3).map((yard) => yard.reason),
                ],
              };
            return preserved.length
              ? { ...completed, phase: "ready", closed, preserved }
              : { ...completed, phase: "ready", closed };
          },
        );
      }
      // A frozen opening cannot be repaired by re-POSTing the closing roster.
      // A failed result ends the durable source without workflow step retries.
      // Every yard's census drifted while it was read, so a fresh crawl later
      // in the day can pass.
      if (next.phase === "failed")
        return {
          ...empty,
          status: "failed" as const,
          failureKind: "transient" as const,
          cursor:
            pagesProcessed === 0
              ? start
              : yield* hollanderstoresAttempt("failed checkpoint", () =>
                  HollanderstoresCursor.checkpoint(cursor),
                ),
          pagesProcessed: pagesProcessed + 1,
          errors: next.errors,
        };
      yield* hollanderstoresAttempt("census bounds", () => {
        if (
          next.requests > HOLLANDERSTORES_MAX_REQUESTS ||
          next.pages.reduce(
            (sum, page) => sum + page.total,
            next.phase === "opening" ? (next.pending?.total ?? 0) : 0,
          ) > HOLLANDERSTORES_MAX_ROWS
        )
          throw new Error(
            "Hollander Stores census exceeds request or row bounds",
          );
      });
      cursor = next;
      pagesProcessed++;
    }
    if (cursor.phase !== "ready")
      return {
        ...empty,
        cursor: yield* hollanderstoresAttempt("checkpoint advance", () =>
          HollanderstoresCursor.checkpoint(cursor),
        ),
        pagesProcessed,
      };
    const ready = cursor;
    if (ready !== start)
      yield* hollanderstoresAttempt("ready checkpoint", () =>
        HollanderstoresCursor.checkpoint(ready),
      );
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
    const drifted = ready.preserved ?? [];
    const snapshot = yield* hollanderstoresAttempt(
      "whole-source and per-yard quality",
      () => {
        const value = hollanderstoresSnapshot(
          ready.pages,
          { ...hollanderstoresSeed, ...known, ...ready.decoded },
          ready.previousAcceptedCount,
          new Set(drifted.map((yard) => yard.code)),
        );
        if (value.errors.length) throw new Error(value.errors.join("; "));
        return value;
      },
    );
    // Drifted and quality-rejected yards, in yard order, so the checkpoint
    // lists each preserved yard once.
    const rejected = new Map(
      [...drifted, ...snapshot.rejectedYards].map((yard) => [yard.code, yard]),
    );
    const preserved = HOLLANDERSTORES_YARDS.flatMap((yard) => {
      const value = rejected.get(yard.code);
      return value ? [value] : [];
    });
    // A census in which no yard publishes is a source failure, never an
    // accepted empty run.
    yield* hollanderstoresAttempt("publishing yards", () => {
      if (preserved.length === HOLLANDERSTORES_YARDS.length)
        throw new Error(
          `every yard failed its census or quality guard, so nothing publishes and all previously published inventory is preserved. Inspect the parser and the first reasons before the next crawl: ${preserved
            .slice(0, 3)
            .map((yard) => yard.reason)
            .join(" | ")}`,
        );
    });
    if (options.onYards) yield* options.onYards([...HOLLANDERSTORES_YARDS]);
    yield* options.onBatch(snapshot.vehicles);
    const complete = yield* hollanderstoresAttempt(
      "terminal checkpoint",
      () => {
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
          ...(preserved.length > 0 ? { preserved } : {}),
        });
      },
    );
    return {
      ...empty,
      status: "complete" as const,
      cursor: complete,
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

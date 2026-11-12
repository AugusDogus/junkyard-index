import { Effect } from "effect";
import type {
  ConnectorChunkAccounting,
  ConnectorChunkStatus,
} from "./connector-chunk";
import {
  fetchClearsalvageCatalog,
  fetchClearsalvageDetail,
  ClearsalvageProviderError,
  clearsalvageValidated,
} from "./clearsalvage-client";
import {
  CLEARSALVAGE_MAX_BODY_BYTES,
  CLEARSALVAGE_MAX_ELAPSED_MS,
  ClearsalvageCursor,
  ClearsalvageCursorSchema,
  type ClearsalvageProgress,
} from "./clearsalvage-cursor";
import { clearsalvageCatalogMembership } from "./clearsalvage-parser";
import {
  clearsalvageSnapshot,
  validateClearsalvageSnapshot,
  type ClearsalvageCanonicalVehicle,
} from "./clearsalvage-transform";
import {
  CLEARSALVAGE_YARD,
  CLEARSALVAGE_MAX_RESPONSE_BYTES,
  clearsalvageCatalogUrl,
  type ClearsalvageYard,
} from "./clearsalvage-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";

interface ClearsalvageOptions<E, R> {
  startCursor?: ClearsalvageCursor;
  /** One serial native catalog, primary donor or closing GET. Default eight. */
  maxPages?: number;
  onBatch: (
    vehicles: ClearsalvageCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: ClearsalvageYard[]) => Effect.Effect<void, E, R>;
}
export interface ClearsalvageStreamResult {
  source: "clearsalvage";
  status: ConnectorChunkStatus;
  cursor: ClearsalvageCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
export function streamClearsalvageInventoryWithRequestGate<E, R>(
  options: ClearsalvageOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const maximum = options.maxPages ?? 8;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 32)
      return yield* Effect.fail(
        new ClearsalvageProviderError({
          operation: "request budget",
          cause: "Use an integer native GET budget from 1 to 32",
        }),
      );
    let cursor = yield* clearsalvageValidated("checkpoint", () =>
      ClearsalvageCursorSchema.parse(
        options.startCursor ?? ClearsalvageCursor.initial,
      ),
    );
    const summary: ClearsalvageStreamResult = {
      source: "clearsalvage",
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
    const chunkStarted = Date.now();
    while (cursor.phase !== "complete") {
      if (
        cursor.phase === "closing" &&
        cursor.closing === cursor.pages.length
      ) {
        const closed = cursor;
        const snapshot = yield* clearsalvageValidated(
          "closed native census",
          () => {
            const value = clearsalvageSnapshot(closed.records);
            validateClearsalvageSnapshot(value);
            return value;
          },
        );
        if (options.onYards) yield* options.onYards([{ ...CLEARSALVAGE_YARD }]);
        yield* options.onBatch(
          snapshot.vehicles.map((vehicle) => ({ ...vehicle })),
        );
        summary.count = snapshot.vehicles.length;
        summary.accounting = { ...snapshot.accounting };
        summary.observedVins = [...snapshot.observedVins];
        summary.warnings = snapshot.accounting.recordsRejected
          ? [
              "Clear Salvage rejected incomplete or conflicting required identity claims; valid rejected VINs remain presence evidence.",
            ]
          : [];
        cursor = { source: "clearsalvage", version: 1, phase: "complete" };
        break;
      }
      if (summary.pagesProcessed >= maximum) break;
      if (Date.now() - chunkStarted > 150_000) break;
      const current: ClearsalvageProgress =
        cursor.phase === "start"
          ? ClearsalvageCursor.start(Date.now())
          : cursor;
      yield* clearsalvageValidated("persisted source bounds", () => {
        if (
          Date.now() < current.startedAt ||
          Date.now() >= current.startedAt + CLEARSALVAGE_MAX_ELAPSED_MS ||
          current.bodyBytes >= CLEARSALVAGE_MAX_BODY_BYTES
        )
          throw new Error(
            "Persisted Clear Salvage hour/body bound is exhausted; inspect the source and start a new census",
          );
      });
      let next: ClearsalvageProgress;
      const maximumBytes = Math.min(
        CLEARSALVAGE_MAX_RESPONSE_BYTES,
        CLEARSALVAGE_MAX_BODY_BYTES - current.bodyBytes,
      );
      if (current.phase === "details") {
        const post = current.pages.flatMap((page) => page.posts)[
          current.records.length
        ];
        if (!post)
          return yield* Effect.fail(
            new ClearsalvageProviderError({
              operation: "donor checkpoint",
              cause: "Next native donor is absent",
            }),
          );
        const record = yield* fetchClearsalvageDetail(post, gate, maximumBytes);
        next = yield* clearsalvageValidated(
          "primary donor checkpoint " + post.id,
          () => {
            const records = [...current.records, record];
            const terminal =
              records.length ===
              current.pages.reduce((sum, page) => sum + page.posts.length, 0);
            return ClearsalvageCursor.checkpoint(
              terminal
                ? {
                    ...current,
                    phase: "closing",
                    records,
                    closing: 0,
                    closingBodyBytes: 0,
                    bodyBytes: current.bodyBytes + record.bodyBytes,
                  }
                : {
                    ...current,
                    records,
                    bodyBytes: current.bodyBytes + record.bodyBytes,
                  },
            );
          },
        );
      } else {
        const expected =
          current.phase === "closing"
            ? current.pages[current.closing]
            : undefined;
        if (current.phase === "closing" && !expected)
          return yield* Effect.fail(
            new ClearsalvageProviderError({
              operation: "closing checkpoint",
              cause: "Next native closing page is absent",
            }),
          );
        const url =
          expected?.url ??
          current.pages.at(-1)?.next ??
          clearsalvageCatalogUrl(1);
        const page = yield* fetchClearsalvageCatalog(url, gate, maximumBytes);
        next = yield* clearsalvageValidated(
          "catalog checkpoint " + page.page,
          () => {
            const bodyBytes = current.bodyBytes + page.bodyBytes;
            if (current.phase === "closing") {
              if (
                !expected ||
                JSON.stringify(clearsalvageCatalogMembership(page)) !==
                  JSON.stringify(clearsalvageCatalogMembership(expected))
              )
                throw new Error(
                  "Clear Salvage closing page changed native ordered IDs, make titles, literal destinations or pagination; restart after inspecting source drift",
                );
              return ClearsalvageCursor.checkpoint({
                ...current,
                closing: current.closing + 1,
                closingBodyBytes: current.closingBodyBytes + page.bodyBytes,
                bodyBytes,
              });
            }
            const pages = [...current.pages, page];
            return ClearsalvageCursor.checkpoint(
              page.next === null
                ? {
                    ...current,
                    phase: "details",
                    pages,
                    records: [],
                    bodyBytes,
                  }
                : { ...current, pages, bodyBytes },
            );
          },
        );
      }
      yield* clearsalvageValidated("persisted source deadline", () => {
        if (Date.now() >= next.startedAt + CLEARSALVAGE_MAX_ELAPSED_MS)
          throw new Error(
            "Clear Salvage complete response crossed its persisted one-hour census deadline",
          );
      });
      summary.pagesProcessed++;
      cursor = next;
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies ClearsalvageStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new ClearsalvageProviderError({
          operation: "chunk deadline",
          cause:
            "Three-minute chunk limit exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}
export function streamClearsalvageInventory<E, R>(
  options: ClearsalvageOptions<E, R>,
) {
  const gate: ProviderRequestGate = (request) =>
    request.pipe(Effect.ensuring(Effect.sleep("1600 millis")));
  return streamClearsalvageInventoryWithRequestGate(options, gate);
}

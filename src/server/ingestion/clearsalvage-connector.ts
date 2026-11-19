import { Effect } from "effect";
import type {
  ConnectorChunkAccounting,
  ConnectorChunkStatus,
} from "./connector-chunk";
import {
  fetchClearsalvageCatalog,
  fetchClearsalvageDetail,
  ClearsalvageBlockedError,
  ClearsalvageProviderError,
  clearsalvageValidated,
} from "./clearsalvage-client";
import {
  CLEARSALVAGE_HOST_COOLDOWNS_MS,
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

/** How early a step may start against the Workflow's sleep before it waits. */
const RETRY_AT_CLOCK_SKEW_MS = 10_000;

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
/** Checkpoint a host refusal so the durable Workflow sleeps, then repeats the
 * same native request. Records, roster and body bytes stay exactly as they
 * were, and the closing pass still proves the roster before any publish. */
function hostCooldown(
  current: ClearsalvageProgress,
  refusal: ClearsalvageBlockedError,
) {
  return clearsalvageValidated("host refusal " + refusal.url, () => {
    const hostBlocks = (current.hostBlocks ?? 0) + 1;
    const cooldownMs = CLEARSALVAGE_HOST_COOLDOWNS_MS[hostBlocks - 1];
    const refused = `host refused ${refusal.url} with HTTP ${refusal.status}`;
    if (cooldownMs === undefined)
      throw new Error(
        `${refused} for the ${hostBlocks}th time in one census after ${CLEARSALVAGE_HOST_COOLDOWNS_MS.length} cooldowns, so the run stops without publishing. Check whether clearsalvage.com now blocks this client before the next scheduled census`,
      );
    const retryAt = Date.now() + Math.max(cooldownMs, refusal.retryAfterMs);
    if (retryAt >= current.startedAt + CLEARSALVAGE_MAX_ELAPSED_MS)
      throw new Error(
        `${refused} and its ${Math.ceil((retryAt - Date.now()) / 1000)}s cooldown ends after the one-hour census deadline, so the run stops without publishing; the next scheduled census starts fresh`,
      );
    return {
      progress: ClearsalvageCursor.checkpoint({
        ...current,
        hostBlocks,
        retryAt,
      }),
      warning: `${refusal.message} Cooldown ${hostBlocks} of ${CLEARSALVAGE_HOST_COOLDOWNS_MS.length} lasts until ${new Date(retryAt).toISOString()}.`,
    };
  });
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
      const progress: ClearsalvageProgress =
        cursor.phase === "start"
          ? ClearsalvageCursor.start(Date.now())
          : cursor;
      // The durable Workflow sleeps until retryAt; never request before it. A
      // wake within clock skew of retryAt waits out the rest, because pausing
      // on the unchanged cursor would fail the run as making no progress.
      if (progress.retryAt !== undefined) {
        const remainingMs = progress.retryAt - Date.now();
        if (remainingMs > RETRY_AT_CLOCK_SKEW_MS) break;
        if (remainingMs > 0) yield* Effect.sleep(remainingMs);
      }
      const current = ClearsalvageCursor.resume(progress);
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
      const maximumBytes = Math.min(
        CLEARSALVAGE_MAX_RESPONSE_BYTES,
        CLEARSALVAGE_MAX_BODY_BYTES - current.bodyBytes,
      );
      const next: ClearsalvageProgress = yield* Effect.gen(function* () {
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
          const record = yield* fetchClearsalvageDetail(
            post,
            gate,
            maximumBytes,
          );
          return yield* clearsalvageValidated(
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
          return yield* clearsalvageValidated(
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
      }).pipe(
        Effect.catchTag("ClearsalvageBlockedError", (refusal) =>
          hostCooldown(current, refusal).pipe(
            Effect.map(({ progress, warning }) => {
              summary.warnings.push(warning);
              return progress;
            }),
          ),
        ),
      );
      yield* clearsalvageValidated("persisted source deadline", () => {
        if (Date.now() >= next.startedAt + CLEARSALVAGE_MAX_ELAPSED_MS)
          throw new Error(
            "Clear Salvage complete response crossed its persisted one-hour census deadline",
          );
      });
      summary.pagesProcessed++;
      cursor = next;
      // Resumed progress never carries retryAt, so only a refusal sets it.
      if (next.retryAt !== undefined) break;
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

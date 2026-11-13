import { Effect, RateLimiter } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  fetchSpeedysPage,
  SpeedysProviderError,
  speedysValidated,
} from "./speedys-client";
import {
  SpeedysCursor,
  SpeedysCursorSchema,
  inspectSpeedysCursor,
  SPEEDYS_MAX_RUN_BYTES,
  SPEEDYS_MAX_RUN_MS,
  SPEEDYS_MAX_RUN_REQUESTS,
} from "./speedys-cursor";
import { parseSpeedysCatalog, parseSpeedysDetail } from "./speedys-parser";
import type { SpeedysCanonicalVehicle } from "./speedys-transform";
import {
  SPEEDYS_MAX_RESPONSE_BYTES,
  SPEEDYS_YARD,
  type SpeedysYard,
} from "./speedys-yard-metadata";

interface SpeedysOptions<E, R> {
  startCursor?: SpeedysCursor;
  /** Serial native GET units, including default, ALL, category and closing controls. */
  maxPages?: number;
  onBatch: (vehicles: SpeedysCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: SpeedysYard[]) => Effect.Effect<void, E, R>;
}
export interface SpeedysStreamResult {
  source: "speedys";
  status: "paused" | "complete";
  cursor: SpeedysCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
export function streamSpeedysInventoryWithRequestGate<E, R>(
  options: SpeedysOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 8;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 32)
      return yield* Effect.fail(
        new SpeedysProviderError({
          operation: "request budget",
          cause: "Use an integer native GET budget from 1 through 32",
        }),
      );
    let cursor = yield* speedysValidated("checkpoint", () =>
      SpeedysCursorSchema.parse(options.startCursor ?? SpeedysCursor.initial),
    );
    const summary: SpeedysStreamResult = {
      source: "speedys",
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
      return { ...summary, status: "complete" as const };
    if (cursor.startedAt === 0)
      cursor = yield* speedysValidated("run origin", () =>
        SpeedysCursor.checkpoint({ ...cursor, startedAt: Date.now() }),
      );
    const chunkStarted = Date.now();
    while (
      cursor.phase !== "complete" &&
      summary.pagesProcessed < budget &&
      Date.now() - chunkStarted < 60_000
    ) {
      const current = cursor;
      const prefix = yield* speedysValidated("run capacity", () => {
        const value = inspectSpeedysCursor(current);
        if (
          Date.now() < current.startedAt ||
          Date.now() - current.startedAt > SPEEDYS_MAX_RUN_MS ||
          value.requests >= SPEEDYS_MAX_RUN_REQUESTS ||
          value.bytes > SPEEDYS_MAX_RUN_BYTES - SPEEDYS_MAX_RESPONSE_BYTES
        )
          throw new Error(
            "Speedys run has exhausted its one-hour, request or full-response byte allowance",
          );
        return value;
      });
      if (current.phase === "catalog" || current.phase === "closing") {
        const closing = current.phase === "closing";
        const completed = closing
          ? current.closing.length
          : current.pages.length;
        const url = prefix.controls[completed];
        if (!url)
          return yield* Effect.fail(
            new SpeedysProviderError({
              operation: "native control prefix",
              cause: "Next catalog control is absent",
            }),
          );
        const raw = yield* fetchSpeedysPage(url, gate);
        cursor = yield* speedysValidated("catalog checkpoint", () => {
          const page = parseSpeedysCatalog(raw, url);
          const pages = [...(closing ? current.closing : current.pages), page];
          const total =
            2 +
            (closing
              ? (current.pages[0]?.categories.length ?? 0)
              : (pages[0]?.categories.length ?? 0));
          return SpeedysCursor.checkpoint(
            closing
              ? {
                  ...current,
                  closing: pages,
                  phase: pages.length === total ? "closing-details" : "closing",
                }
              : {
                  ...current,
                  pages,
                  phase: pages.length === total ? "details" : "catalog",
                },
          );
        });
      } else {
        const closing = current.phase === "closing-details";
        const completed = closing
          ? current.closingRecords.length
          : current.records.length;
        const post = prefix.posts[completed];
        if (!post)
          return yield* Effect.fail(
            new SpeedysProviderError({
              operation: "native detail prefix",
              cause: "Next enumerated donor destination is absent",
            }),
          );
        const raw = yield* fetchSpeedysPage(post.url, gate);
        cursor = yield* speedysValidated("donor checkpoint", () => {
          const record = parseSpeedysDetail(raw, post);
          const records = [
            ...(closing ? current.closingRecords : current.records),
            record,
          ];
          return SpeedysCursor.checkpoint(
            closing
              ? {
                  ...current,
                  closingRecords: records,
                  phase:
                    records.length === prefix.posts.length
                      ? "complete"
                      : "closing-details",
                }
              : {
                  ...current,
                  records,
                  phase:
                    records.length === prefix.posts.length
                      ? "closing"
                      : "details",
                },
          );
        });
      }
      summary.pagesProcessed++;
    }
    if (cursor.phase !== "complete") return { ...summary, cursor };
    const { snapshot } = yield* speedysValidated("complete snapshot", () =>
      inspectSpeedysCursor(cursor),
    );
    yield* options.onBatch(snapshot.vehicles);
    if (options.onYards) yield* options.onYards([{ ...SPEEDYS_YARD }]);
    return {
      ...summary,
      cursor,
      status: "complete" as const,
      count: snapshot.vehicles.length,
      observedVins: snapshot.observedVins,
      accounting: snapshot.accounting,
      warnings: snapshot.accounting.recordsRejected
        ? [
            "Speedys rejected incomplete or conflicting required donor fields; independently valid rejected VINs supply presence evidence only.",
          ]
        : [],
    };
  }).pipe(
    Effect.timeoutFail({
      duration: "90 seconds",
      onTimeout: () =>
        new SpeedysProviderError({
          operation: "chunk deadline",
          cause:
            "90-second chunk deadline exceeded; retain the prior checkpoint",
        }),
    }),
  );
}
export function streamSpeedysInventory<E, R>(options: SpeedysOptions<E, R>) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamSpeedysInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}

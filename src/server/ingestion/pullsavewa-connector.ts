import { Effect, RateLimiter } from "effect";
import {
  fetchPullsavewaPage,
  PullsavewaProviderError,
} from "./pullsavewa-client";
import { PullsavewaCursor, PullsavewaCursorSchema } from "./pullsavewa-cursor";
import {
  parsePullsavewaPage,
  PULLSAVEWA_DISCLAIMER,
  validatePullsavewaSnapshot,
} from "./pullsavewa-parser";
import {
  transformPullsavewaRecord,
  type PullsavewaCanonicalVehicle,
} from "./pullsavewa-transform";
import {
  PULLSAVEWA_YARDS,
  validatePullsavewaHome,
  type PullsavewaYard,
} from "./pullsavewa-yard-metadata";
import type { ConnectorChunkResult } from "./connector-chunk";
import { inventoryVin } from "./inventory-vin";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";

interface PullsavewaOptions<E, R> {
  startCursor?: PullsavewaCursor;
  maxPages?: number;
  onBatch: (
    vehicles: PullsavewaCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: PullsavewaYard[]) => Effect.Effect<void, E, R>;
}
export type PullsavewaStreamResult = ConnectorChunkResult<
  "pullsavewa",
  PullsavewaCursor
>;

export function streamPullsavewaInventoryWithRequestGate<E, R>(
  options: PullsavewaOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = PullsavewaCursorSchema.safeParse(
      options.startCursor ?? PullsavewaCursor.initial,
    );
    const maxPages = options.maxPages ?? 1;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* new PullsavewaProviderError({
        operation: "checkpoint",
        cause:
          "Invalid cursor or yard snapshot budget; use a validated cursor and a 1-32 budget",
      });
    const cursor = parsed.data;
    const summary: PullsavewaStreamResult = {
      source: "pullsavewa",
      status: "complete",
      cursor: { source: "pullsavewa", phase: "complete" },
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
    if (cursor.phase === "complete") return summary;
    const seen = new Set(cursor.phase === "yards" ? cursor.vins : []);
    const start = cursor.phase === "yards" ? cursor.nextYard : 0;
    for (
      let index = start;
      index < PULLSAVEWA_YARDS.length && summary.pagesProcessed < maxPages;
      index++
    ) {
      const yard = PULLSAVEWA_YARDS[index];
      if (!yard)
        return yield* new PullsavewaProviderError({
          operation: "yard lookup",
          cause: "Unknown verified yard index " + index,
        });
      const home = yield* fetchPullsavewaPage(yard, yard.websiteUrl, gate);
      yield* Effect.try({
        try: () => validatePullsavewaHome(home, yard),
        catch: (cause) =>
          new PullsavewaProviderError({
            operation: yard.code + " ownership",
            cause,
          }),
      });
      const firstHtml = yield* fetchPullsavewaPage(
        yard,
        yard.inventoryUrl,
        gate,
      );
      const first = yield* Effect.try({
        try: () => parsePullsavewaPage(firstHtml, yard, "first"),
        catch: (cause) =>
          new PullsavewaProviderError({
            operation: yard.code + " native scope",
            cause,
          }),
      });
      const allHtml = yield* fetchPullsavewaPage(
        yard,
        yard.inventoryUrl + "?recperpage=ALL",
        gate,
      );
      const lastHtml = first.terminalUrl
        ? yield* fetchPullsavewaPage(yard, first.terminalUrl, gate)
        : firstHtml;
      const snapshot = yield* Effect.try({
        try: () => {
          const all = parsePullsavewaPage(allHtml, yard, "all");
          const last = parsePullsavewaPage(lastHtml, yard, "last");
          const records = validatePullsavewaSnapshot(first, all, last);
          const vehicles: PullsavewaCanonicalVehicle[] = [];
          const observedVins: string[] = [];
          let rejected = 0;
          for (const record of records) {
            const vin = inventoryVin(record.vin, record.year);
            if (vin !== null && seen.has(vin))
              throw new Error(
                "Duplicate native VIN/serial identity within or across Pull & Save yards",
              );
            if (vin !== null) seen.add(vin);
            const result = transformPullsavewaRecord(record, yard);
            if (result.status === "available") vehicles.push(result.vehicle);
            else {
              rejected++;
              if (result.vin !== null) observedVins.push(result.vin);
            }
          }
          if (
            !vehicles.length ||
            rejected / records.length >
              SourceValidationPolicy.maximumRejectionRatio
          )
            throw new Error(
              `Pull & Save ${yard.code} quality failed: ${rejected} rejected of ${records.length} rows; retain the per-yard 10% rejection limit`,
            );
          return {
            vehicles,
            observedVins,
            rejected,
            processed: records.length,
          };
        },
        catch: (cause) =>
          new PullsavewaProviderError({
            operation: yard.code + " complete catalog validation",
            cause,
          }),
      });
      if (options.onYards) yield* options.onYards([yard]);
      yield* options.onBatch(snapshot.vehicles);
      summary.count += snapshot.vehicles.length;
      summary.pagesProcessed++;
      summary.observedVins?.push(...snapshot.observedVins);
      if (summary.accounting) {
        summary.accounting.recordsProcessed += snapshot.processed;
        summary.accounting.recordsRejected += snapshot.rejected;
      }
      summary.warnings = [
        ...new Set([
          ...(summary.warnings ?? []),
          PULLSAVEWA_DISCLAIMER,
          ...(snapshot.rejected
            ? [
                `Pull & Save ${yard.code} rejected ${snapshot.rejected} incomplete donors; valid rejected identities supply presence evidence only.`,
              ]
            : []),
        ]),
      ];
      summary.cursor =
        index === 0
          ? {
              source: "pullsavewa",
              phase: "yards",
              nextYard: 1,
              processed: snapshot.processed,
              emitted: snapshot.vehicles.length,
              rejected: snapshot.rejected,
              vins: [...seen],
            }
          : { source: "pullsavewa", phase: "complete" };
      summary.status =
        summary.cursor.phase === "complete" ? "complete" : "paused";
    }
    return summary;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new PullsavewaProviderError({
          operation: "catalog budget",
          cause:
            "Three-minute crawl limit exceeded; no advanced checkpoint returned",
        }),
    }),
  );
}

export function streamPullsavewaInventory<E, R>(
  options: PullsavewaOptions<E, R>,
) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamPullsavewaInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}

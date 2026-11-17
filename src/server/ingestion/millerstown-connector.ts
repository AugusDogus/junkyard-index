import { ingestionValidation } from "./ingestion-validation";
import { createHash } from "node:crypto";
import { Effect, RateLimiter } from "effect";
import {
  fetchMillerstownHtml,
  fetchMillerstownPdf,
  MillerstownProviderError,
} from "./millerstown-client";
import {
  MillerstownCursor,
  MillerstownCursorSchema,
} from "./millerstown-cursor";
import {
  MillerstownDonor,
  type MillerstownCanonicalVehicle,
} from "./millerstown-donor";
import {
  parseMillerstownInventory,
  parseMillerstownRoot,
} from "./millerstown-parser";
import { parseMillerstownPdf } from "./millerstown-pdf";
import { MILLERSTOWN_YARD } from "./millerstown-yard-metadata";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { PipelineSourceName } from "./pipeline-policy";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";

export type MillerstownStreamResult = Omit<
  ConnectorChunkResult<PipelineSourceName, MillerstownCursor>,
  "source" | "status"
> & { source: "millerstown"; status: "complete" };
interface MillerstownOptions<E, R> {
  startCursor?: unknown;
  maxPages?: number;
  onBatch: (
    vehicles: MillerstownCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: (typeof MILLERSTOWN_YARD)[]) => Effect.Effect<void, E, R>;
}
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
function parse<A>(operation: string, read: () => A) {
  return ingestionValidation({
    try: read,
    catch: (cause) => new MillerstownProviderError({ operation, cause }),
  });
}

export function streamMillerstownInventoryWithRequestGate<E, R>(
  options: MillerstownOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const checkpoint = MillerstownCursorSchema.safeParse(
      options.startCursor === undefined
        ? MillerstownCursor.initial
        : options.startCursor,
    );
    const maxPages = options.maxPages === undefined ? 1 : options.maxPages;
    if (
      !checkpoint.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* new MillerstownProviderError({
        operation: "checkpoint",
        cause:
          "Invalid cursor or catalog budget; use the strict start cursor and a 1-32 logical catalog budget",
      });
    const complete: MillerstownStreamResult = {
      source: "millerstown",
      status: "complete",
      cursor: { source: "millerstown", phase: "complete" },
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
    if (checkpoint.data.phase === "complete") return complete;
    const rootHtml = yield* fetchMillerstownHtml("root", gate);
    const root = yield* parse("root ownership and self-service scope", () =>
      parseMillerstownRoot(rootHtml),
    );
    const openingHtml = yield* fetchMillerstownHtml("inventory", gate);
    const opening = yield* parse("opening inventory scope", () => {
      const inventory = parseMillerstownInventory(openingHtml);
      const { name, address, contact } = inventory.proof;
      if (JSON.stringify(root) !== JSON.stringify({ name, address, contact }))
        throw new Error("Root and inventory physical owner differ");
      return inventory;
    });
    const openingPdf = yield* fetchMillerstownPdf(opening.pdfUrl, gate);
    const records = yield* Effect.tryPromise({
      try: () => parseMillerstownPdf(openingPdf),
      catch: (cause) =>
        new MillerstownProviderError({
          operation: "complete PDF grammar and enumeration",
          cause,
        }),
    });
    const snapshot = yield* parse("complete catalog quality", () => {
      const vehicles: MillerstownCanonicalVehicle[] = [];
      const identities = new Set<string>();
      const observedVins: string[] = [];
      let rejected = 0;
      for (const record of records) {
        const result = MillerstownDonor.parse(record.raw);
        const vin =
          result.status === "available" ? result.vehicle.vin : result.vin;
        if (vin !== null) {
          if (identities.has(vin))
            throw new Error(
              `Repeated native identity ${vin}; separate source rows cannot be merged`,
            );
          identities.add(vin);
        }
        if (result.status === "available") vehicles.push(result.vehicle);
        else {
          rejected++;
          if (vin !== null) observedVins.push(vin);
        }
      }
      if (
        vehicles.length < 362 ||
        rejected / records.length > SourceValidationPolicy.maximumRejectionRatio
      )
        throw new Error(
          `Catalog quality failed: ${vehicles.length} complete and ${rejected} rejected of ${records.length} source rows; require 362 complete donors and retain the shared 10% rejection limit`,
        );
      return { vehicles, observedVins, rejected };
    });
    const closingHtml = yield* fetchMillerstownHtml("inventory", gate);
    yield* parse("closing inventory scope and published link", () => {
      const closing = parseMillerstownInventory(closingHtml);
      if (JSON.stringify(closing) !== JSON.stringify(opening))
        throw new Error(
          "Native owner, full inventory scope or published PDF link changed during the catalog read",
        );
    });
    const closingPdf = yield* fetchMillerstownPdf(opening.pdfUrl, gate);
    yield* parse("closing complete PDF byte proof", () => {
      if (digest(openingPdf) !== digest(closingPdf))
        throw new Error(
          "Complete opening and closing PDF byte hashes differ; rerun from start after the native catalog settles",
        );
    });
    const count = snapshot.vehicles.length;
    if (options.onYards) yield* options.onYards([{ ...MILLERSTOWN_YARD }]);
    yield* options.onBatch(snapshot.vehicles);
    return {
      ...complete,
      count,
      pagesProcessed: 1,
      observedVins: snapshot.observedVins,
      warnings: snapshot.rejected
        ? [
            `Millerstown rejected ${snapshot.rejected} incomplete source rows; valid rejected identities supply presence evidence only.`,
          ]
        : [],
      accounting: {
        recordsProcessed: records.length,
        recordsExcluded: 0,
        recordsRejected: snapshot.rejected,
        duplicateVehicles: 0,
      },
    } satisfies MillerstownStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "2 minutes",
      onTimeout: () =>
        new MillerstownProviderError({
          operation: "catalog budget",
          cause:
            "Two-minute catalog deadline exceeded; no complete checkpoint returned",
        }),
    }),
  );
}

export function streamMillerstownInventory<E, R>(
  options: MillerstownOptions<E, R>,
) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamMillerstownInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}

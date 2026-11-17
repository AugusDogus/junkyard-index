import { Effect } from "effect";
import { Config } from "./context";
import type { ConnectorChunkResult } from "./connector-chunk";
import { ingestionValidation } from "./ingestion-validation";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import {
  VANDERHAAGS_CATALOG_PATH,
  VANDERHAAGS_PAGE_SIZE,
  parseVanderHaagsPage,
  parseVanderHaagsDetail,
  vanderHaagsCatalogHash,
  type VanderHaagsDonor,
} from "./vanderhaags-catalog";
import {
  VanderHaagsCursor,
  VanderHaagsCursorSchema,
} from "./vanderhaags-cursor";
import {
  acquireVanderHaagsSession,
  type VanderHaagsPageSource,
} from "./vanderhaags-browser-session";
import {
  transformVanderHaagsDonor,
  VANDERHAAGS_YARD,
} from "./vanderhaags-transform";

interface Options<E, R> {
  startCursor?: VanderHaagsCursor;
  /** Detail requests per checkpoint, not concurrent requests. */
  maxPages?: number;
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: (typeof VANDERHAAGS_YARD)[]) => Effect.Effect<void, E, R>;
}
export type VanderHaagsStreamResult = ConnectorChunkResult<
  "vanderhaags",
  VanderHaagsCursor
>;

const empty: VanderHaagsStreamResult = {
  source: "vanderhaags",
  status: "complete",
  cursor: { source: "vanderhaags", phase: "complete" },
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

function validate<T>(body: () => T) {
  return ingestionValidation({
    try: body,
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  });
}

function catalog<E>(source: VanderHaagsPageSource<E>) {
  return Effect.gen(function* () {
    const first = yield* source.fetchPage(VANDERHAAGS_CATALOG_PATH);
    const parsed = yield* validate(() => parseVanderHaagsPage(first, 1));
    const donors: VanderHaagsDonor[] = [...parsed.donors];
    const pages = Math.ceil(parsed.total / VANDERHAAGS_PAGE_SIZE);
    for (let page = 2; page <= pages; page++) {
      const html = yield* source.fetchPage(
        VANDERHAAGS_CATALOG_PATH +
          "&page=" +
          page +
          "&recordcount=" +
          parsed.total +
          "&paged=true",
      );
      const next = yield* validate(() => parseVanderHaagsPage(html, page));
      if (next.total !== parsed.total)
        return yield* Effect.fail(
          new Error("Vander Haags catalog count changed during enumeration"),
        );
      donors.push(...next.donors);
    }
    if (
      donors.length !== parsed.total ||
      new Set(donors.map((d) => d.id)).size !== donors.length
    )
      return yield* Effect.fail(
        new Error(
          "Vander Haags catalog does not reconcile to unique donor IDs",
        ),
      );
    const selected = donors.filter((d) => d.yard === "Sioux Falls, SD");
    if (
      selected.length < 95 ||
      new Set(selected.map((d) => d.stock)).size !== selected.length
    )
      return yield* Effect.fail(
        new Error(
          "Vander Haags Sioux Falls census fell below 95 donors or repeated stock identities",
        ),
      );
    return { donors: selected, hash: vanderHaagsCatalogHash(donors) };
  });
}

export function streamVanderHaagsInventoryFromSource<E, R, FetchError>(
  options: Options<E, R>,
  source: VanderHaagsPageSource<FetchError>,
) {
  return Effect.gen(function* () {
    const decoded = VanderHaagsCursorSchema.safeParse(
      options.startCursor ?? VanderHaagsCursor.initial,
    );
    const budget = options.maxPages ?? 12;
    if (
      !decoded.success ||
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 24
    )
      return yield* Effect.fail(
        new Error(
          "Invalid Vander Haags checkpoint or detail budget; restart with 1-24 details per checkpoint",
        ),
      );
    const cursor = decoded.data;
    if (cursor.phase === "complete") return empty;
    const snapshot = yield* catalog(source);
    const offset = cursor.phase === "details" ? cursor.offset : 0;
    if (
      cursor.phase === "details" &&
      (cursor.catalogHash !== snapshot.hash || offset >= snapshot.donors.length)
    )
      return yield* Effect.fail(
        new Error(
          "Vander Haags catalog changed since checkpoint; restart enumeration",
        ),
      );
    const seen = new Set(cursor.phase === "details" ? cursor.seenVins : []);
    const vehicles: CanonicalVehicle[] = [];
    const observedVins: string[] = [];
    let rejected = 0;
    const end = Math.min(offset + budget, snapshot.donors.length);
    for (const donor of snapshot.donors.slice(offset, end)) {
      const html = yield* source.fetchPage(donor.path);
      const fields = yield* validate(() => parseVanderHaagsDetail(html, donor));
      const result = transformVanderHaagsDonor(donor, fields);
      const vin =
        result.status === "available" ? result.vehicle.vin : result.vin;
      if (vin && seen.has(vin))
        return yield* Effect.fail(
          new Error(
            "Vander Haags returned a repeated VIN across donor IDs: " +
              donor.id,
          ),
        );
      if (vin) seen.add(vin);
      if (result.status === "available") vehicles.push(result.vehicle);
      else {
        rejected++;
        if (result.vin) observedVins.push(result.vin);
      }
    }
    const totalRejected =
      rejected + (cursor.phase === "details" ? cursor.rejected : 0);
    const complete = end === snapshot.donors.length;
    if (complete) {
      if (totalRejected / end > SourceValidationPolicy.maximumRejectionRatio)
        return yield* Effect.fail(
          new Error("Vander Haags exceeded the 10% rejected donor limit"),
        );
      // A fresh complete enumeration fences removal reconciliation.
      const closing = yield* catalog(source);
      if (closing.hash !== snapshot.hash)
        return yield* Effect.fail(
          new Error(
            "Vander Haags catalog changed before completion; restart enumeration",
          ),
        );
    }
    if (options.onYards) yield* options.onYards([VANDERHAAGS_YARD]);
    if (vehicles.length) yield* options.onBatch(vehicles);
    return {
      ...empty,
      status: complete ? "complete" : "paused",
      cursor: complete
        ? empty.cursor
        : {
            source: "vanderhaags",
            phase: "details",
            catalogHash: snapshot.hash,
            offset: end,
            rejected: totalRejected,
            seenVins: [...seen],
          },
      count: vehicles.length,
      pagesProcessed: end - offset,
      observedVins,
      warnings: rejected
        ? [
            "Vander Haags rejected " +
              rejected +
              " donors with incomplete identity or description; valid VINs supply presence evidence only.",
          ]
        : [],
      accounting: {
        recordsProcessed: end - offset,
        recordsExcluded: 0,
        recordsRejected: rejected,
        duplicateVehicles: 0,
      },
    } satisfies VanderHaagsStreamResult;
  });
}

export function streamVanderHaagsInventory<E, R>(options: Options<E, R>) {
  if (options.startCursor?.phase === "complete") return Effect.succeed(empty);
  return Effect.scoped(
    Effect.gen(function* () {
      const config = yield* Config;
      const source = yield* acquireVanderHaagsSession(
        config.hyperbrowserApiKey,
      );
      return yield* streamVanderHaagsInventoryFromSource(options, source);
    }),
  ).pipe(
    Effect.timeoutFail({
      duration: "4 minutes",
      onTimeout: () =>
        new Error("Vander Haags checkpoint exceeded four minutes"),
    }),
    Effect.mapError(
      (cause) =>
        new Error(
          "Vander Haags ingestion failed: " +
            String(cause) +
            ". Reconciliation is blocked and previous inventory is preserved. Inspect the native catalog, then restart enumeration.",
        ),
    ),
  );
}

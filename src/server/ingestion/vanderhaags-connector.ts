import { createHash } from "node:crypto";
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
import { transformVanderHaagsDonor } from "./vanderhaags-transform";
import { VANDERHAAGS_YARDS, type VanderHaagsYard } from "./vanderhaags-yards";
import type { Yard } from "~/lib/yard";

import {
  carryVanderHaagsDetail,
  vanderHaagsDetailEvidence,
  VANDERHAAGS_CENSUS_CONTRACT,
  VANDERHAAGS_DAY_MS,
  VanderHaagsCensus,
} from "./vanderhaags-census";

interface Options<E, R> {
  /** Only the previous accepted, search-published terminal checkpoint. */
  previousCursor?: unknown;
  yards?: readonly VanderHaagsYard[];
  now?: () => number;
  startCursor?: VanderHaagsCursor;
  /** Detail requests per checkpoint, not concurrent requests. */
  maxPages?: number;
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: Yard[]) => Effect.Effect<void, E, R>;
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

function catalog<E>(
  source: VanderHaagsPageSource<E>,
  yards: readonly VanderHaagsYard[],
) {
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
    const selected = donors.filter((d) =>
      yards.some((y) => y.catalogLabel === d.yard),
    );
    for (const yard of yards) {
      const local = selected.filter((d) => d.yard === yard.catalogLabel);
      if (
        local.length < yard.minimumInventory ||
        new Set(local.map((d) => d.stock)).size !== local.length
      )
        return yield* Effect.fail(
          new Error(
            `Vander Haags ${yard.yard.city} census fell below ${yard.minimumInventory} donors or repeated stock identities`,
          ),
        );
    }
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
    if (cursor.phase === "complete") return { ...empty, cursor };
    const yards = options.yards ?? VANDERHAAGS_YARDS;
    const now = options.now ?? Date.now;
    const startedAt =
      cursor.phase === "details" ? cursor.census.startedAt : now();
    const scope = createHash("sha256")
      .update(JSON.stringify(yards))
      .digest("hex");
    const previous = VanderHaagsCursorSchema.safeParse(options.previousCursor);
    const compatible =
      previous.success &&
      previous.data.phase === "complete" &&
      previous.data.census?.scope === scope &&
      previous.data.census.startedAt <= startedAt
        ? previous.data.census
        : undefined;
    const warnings: string[] = [];
    if (cursor.phase === "start" && options.previousCursor && !compatible)
      warnings.push(
        "Previous Vander Haags census is incompatible; reading every detail.",
      );
    const census: VanderHaagsCensus =
      cursor.phase === "details"
        ? cursor.census
        : VanderHaagsCensus.checkpoint({
            contract: VANDERHAAGS_CENSUS_CONTRACT,
            scope,
            startedAt,
            entries: compatible?.entries ?? [],
          });
    const checkAge = () => {
      if (
        census.scope !== scope ||
        startedAt > now() ||
        now() - startedAt >= VANDERHAAGS_DAY_MS - 4 * 60 * 1000
      )
        throw new Error(
          "Vander Haags census contract changed or its one-day deadline expired; restart enumeration. Previous inventory is preserved.",
        );
    };
    yield* validate(checkAge);
    const snapshot = yield* catalog(source, yards);
    const entries = new Map(census.entries.map((entry) => [entry.path, entry]));
    // Removed catalog identities never enter the new terminal census.
    const paths = new Set(snapshot.donors.map((d) => d.path));
    for (const path of entries.keys())
      if (!paths.has(path)) entries.delete(path);
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
    if (cursor.phase === "details") {
      yield* validate(() => {
        const prefix = snapshot.donors.slice(0, offset).map((donor) => {
          const evidence = entries.get(donor.path);
          if (
            !evidence ||
            evidence.identity !== vanderHaagsCatalogHash([donor]) ||
            startedAt - evidence.readAt >= 6 * VANDERHAAGS_DAY_MS
          )
            throw new Error(
              "Vander Haags checkpoint lost processed detail evidence; restart enumeration",
            );
          return transformVanderHaagsDonor(
            donor,
            new Map(evidence.fields),
            evidence.availability,
          );
        });
        const vins = prefix.flatMap((result) => {
          const vin =
            result.status === "available" ? result.vehicle.vin : result.vin;
          return vin ? [vin] : [];
        });
        if (
          prefix.filter((r) => r.status === "rejected").length !==
            cursor.rejected ||
          JSON.stringify(vins) !== JSON.stringify(cursor.seenVins)
        )
          throw new Error(
            "Vander Haags checkpoint accounting disagrees with detail evidence",
          );
      });
    }
    const seen = new Set(cursor.phase === "details" ? cursor.seenVins : []);
    const vehicles: CanonicalVehicle[] = [];
    const observedVins: string[] = [];
    let rejected = 0;
    let end = offset;
    let detailRequests = 0;
    for (const [index, donor] of snapshot.donors.entries()) {
      if (index < offset) continue;
      yield* validate(checkAge);
      let evidence = carryVanderHaagsDetail(
        donor,
        index,
        entries.get(donor.path),
        startedAt,
      );
      if (!evidence) {
        if (detailRequests >= budget) break;
        const html = yield* source.fetchPage(donor.path);
        const detail = yield* validate(() =>
          parseVanderHaagsDetail(html, donor),
        );
        evidence = vanderHaagsDetailEvidence(
          donor,
          detail.fields,
          startedAt,
          detail.availability,
        );
        entries.set(donor.path, evidence);
        detailRequests++;
      }
      const result = transformVanderHaagsDonor(
        donor,
        new Map(evidence.fields),
        evidence.availability,
      );
      end++;
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
      yield* validate(() => {
        const accepted = snapshot.donors.flatMap((donor) => {
          const evidence = entries.get(donor.path);
          if (!evidence)
            throw new Error("Vander Haags census lost a donor detail");
          const result = transformVanderHaagsDonor(
            donor,
            new Map(evidence.fields),
            evidence.availability,
          );
          return result.status === "available" ? [result.vehicle] : [];
        });
        for (const yard of yards) {
          const count = accepted.filter(
            (v) => v.locationCode === yard.yard.code,
          ).length;
          if (count < yard.minimumInventory)
            throw new Error(
              `Vander Haags ${yard.yard.city} accepted ${count} donors, below its floor ${yard.minimumInventory}; prior inventory is preserved`,
            );
          const local = snapshot.donors.filter(
            (d) => d.yard === yard.catalogLabel,
          ).length;
          if (
            (local - count) / local >
            SourceValidationPolicy.maximumRejectionRatio
          )
            throw new Error(
              `Vander Haags ${yard.yard.city} exceeded the 10% rejected donor limit`,
            );
        }
      });
      // A fresh complete enumeration fences removal reconciliation.
      const closing = yield* catalog(source, yards);
      if (closing.hash !== snapshot.hash)
        return yield* Effect.fail(
          new Error(
            "Vander Haags catalog changed before completion; restart enumeration",
          ),
        );
    }
    yield* validate(checkAge);
    const nextCensus = yield* validate(() =>
      VanderHaagsCensus.checkpoint({
        ...census,
        entries: [...entries.values()],
      }),
    );
    if (options.onYards) yield* options.onYards(yards.map((y) => y.yard));
    if (vehicles.length) yield* options.onBatch(vehicles);
    return {
      ...empty,
      status: complete ? "complete" : "paused",
      cursor: complete
        ? { source: "vanderhaags", phase: "complete", census: nextCensus }
        : {
            source: "vanderhaags",
            phase: "details",
            catalogHash: snapshot.hash,
            offset: end,
            rejected: totalRejected,
            seenVins: [...seen],
            census: nextCensus,
          },
      count: vehicles.length,
      pagesProcessed: detailRequests,
      observedVins,
      warnings: [
        ...warnings,
        ...(rejected
          ? [
              "Vander Haags rejected " +
                rejected +
                " donors without usable identity, description or available quantity; valid VINs supply presence evidence only.",
            ]
          : []),
      ],
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
  if (options.startCursor?.phase === "complete")
    return validate(() => ({
      ...empty,
      cursor: VanderHaagsCursorSchema.parse(options.startCursor),
    }));
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

import { pypYard, type OnYards } from "./yard-metadata";
import { Effect, Scope } from "effect";
import type { Location } from "~/lib/types";
import type { PypFilterResponse } from "./pyp-api";
import { transformPypVehicle } from "./pyp-transform";
import type { CanonicalVehicle } from "./types";
import { PypSessionError } from "./errors";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { PypActiveCursor, PypStoreCursor } from "./durable-cursor";
import { acquireDirectPypSession } from "./pyp-direct-session";

const PAGE_SIZE = 500;

export type PypStreamResult = ConnectorChunkResult<"pyp", PypStoreCursor>;

function processPage(
  data: PypFilterResponse,
  pageNumber: number,
  locationMap: Map<string, Location>,
): {
  vehicleCount: number;
  canonical: CanonicalVehicle[];
  isLastPage: boolean;
  apiError: string | null;
} {
  if (!data.Success) {
    return {
      vehicleCount: 0,
      canonical: [],
      isLastPage: true,
      apiError: `PYP Filter API error on page ${pageNumber}: ${data.Errors.join(", ")}`,
    };
  }

  const pageVehicles = data.ResponseData?.Vehicles ?? [];
  if (pageVehicles.length === 0) {
    return { vehicleCount: 0, canonical: [], isLastPage: true, apiError: null };
  }

  const canonical: CanonicalVehicle[] = [];
  for (const v of pageVehicles) {
    const c = transformPypVehicle(v, locationMap);
    if (c) canonical.push(c);
  }

  return {
    vehicleCount: pageVehicles.length,
    canonical,
    isLastPage: pageVehicles.length < PAGE_SIZE,
    apiError: null,
  };
}

function assertMinLocations(locations: Location[]) {
  if (locations.length < 20) {
    throw new Error(
      `PYP returned only ${locations.length} locations (expected 20+). ` +
        `This likely means PYP locations are currently unavailable. Aborting PYP ingestion for this run.`,
    );
  }
}

function orderedStoreCodes(locations: Location[]): string[] {
  const codes = locations.map((location) => location.locationCode).sort();
  if (new Set(codes).size !== codes.length) {
    throw new Error("PYP location list contains duplicate store codes");
  }
  return codes;
}

function assertSameStores(expected: string[] | null, actual: string[]) {
  if (
    expected !== null &&
    (expected.length !== actual.length ||
      expected.some((code, index) => code !== actual[index]))
  ) {
    throw new Error(
      "PYP store list changed during the inventory run. Start a new run so every store is crawled exactly once.",
    );
  }
}

// Freeze the store list in the cursor so a changing directory cannot silently
// skip a yard while a run moves between durable workflow chunks.
export function streamPypInventory<E, R>(options: {
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: OnYards;
  cursor: PypStoreCursor;
  maxPages?: number;
}): Effect.Effect<
  PypStreamResult,
  PypSessionError | E,
  Scope.Scope | R
> {
  return Effect.gen(function* () {
    const session = yield* acquireDirectPypSession();
    const storeCodes = yield* Effect.try({
      try: () => {
        assertMinLocations(session.locations);
        const codes = orderedStoreCodes(session.locations);
        assertSameStores(options.cursor.storeCodes, codes);
        return codes;
      },
      catch: (cause) => new PypSessionError({ phase: "open", cause }),
    });
    const locationMap = new Map(
      session.locations.map((location) => [location.locationCode, location]),
    );
    if (options.onYards) yield* options.onYards(session.locations.map(pypYard));

    let cursor: PypActiveCursor = {
      source: "pyp",
      storeCodes,
      storeIndex: options.cursor.storeIndex,
      page: options.cursor.page,
    };
    let count = 0;
    let pagesProcessed = 0;
    const errors: string[] = [];
    const maxPages = Math.max(1, options.maxPages ?? Number.MAX_SAFE_INTEGER);

    yield* Effect.logInfo(
      `[PYP] Streaming inventory from ${storeCodes.length} stores via zero-based per-store JSON pages`,
    );

    while (cursor.storeIndex < storeCodes.length && pagesProcessed < maxPages) {
      const storeCode = storeCodes[cursor.storeIndex];
      if (storeCode === undefined) {
        return yield* Effect.fail(
          new PypSessionError({
            phase: "fetch",
            cause: new Error(`PYP store index ${cursor.storeIndex} is missing`),
          }),
        );
      }

      const pageNumber: number = cursor.page;
      const fetchResult = yield* session
        .fetchFilterPage(storeCode, pageNumber, PAGE_SIZE)
        .pipe(
          Effect.map((data) => ({ ok: true as const, data })),
          Effect.catchAll((error) =>
            Effect.succeed({ ok: false as const, error }),
          ),
        );
      if (!fetchResult.ok) {
        const message = `PYP store ${storeCode} page ${pageNumber}: ${fetchResult.error.message}. No checkpoint advanced; inspect PYP access from this runtime.`;
        yield* Effect.logError(message);
        errors.push(message);
        break;
      }

      const data = fetchResult.data;
      if (!data.Success) {
        errors.push(
          `PYP store ${storeCode} page ${pageNumber}: ${data.Errors.join(", ")}`,
        );
        break;
      }
      const request = data.ResponseData.Request;
      const mismatchedVehicle = data.ResponseData.Vehicles.find(
        (vehicle) => vehicle.YardCode !== storeCode,
      );
      if (
        request.PageNumber !== pageNumber + 1 ||
        request.PageSize !== PAGE_SIZE ||
        request.YardCode.length !== 1 ||
        request.YardCode[0] !== storeCode ||
        mismatchedVehicle !== undefined
      ) {
        errors.push(
          `PYP store ${storeCode} page ${pageNumber}: response does not match the request. Expected yard ${storeCode}, echoed page ${pageNumber + 1}, size ${PAGE_SIZE}; got yards ${request.YardCode.join(",")}, page ${request.PageNumber}, size ${request.PageSize}, first unexpected vehicle yard ${mismatchedVehicle?.YardCode ?? "none"}. No checkpoint advanced; inspect the PYP API contract.`,
        );
        break;
      }

      const result = processPage(data, pageNumber, locationMap);
      if (result.apiError) {
        errors.push(`PYP store ${storeCode}: ${result.apiError}`);
        break;
      }
      if (result.canonical.length > 0) {
        yield* options.onBatch(result.canonical);
      }
      count += result.canonical.length;
      pagesProcessed++;
      yield* Effect.logInfo(
        `[PYP] Store ${storeCode} page ${pageNumber}: ${result.vehicleCount} vehicles fetched, ${result.canonical.length} transformed (${count} this chunk)`,
      );

      cursor = result.isLastPage
        ? { ...cursor, storeIndex: cursor.storeIndex + 1, page: 0 }
        : { ...cursor, page: pageNumber + 1 };
    }

    const status =
      errors.length > 0
        ? "failed"
        : cursor.storeIndex === storeCodes.length
          ? "complete"
          : "paused";
    yield* Effect.logInfo(
      `[PYP] Per-store stream ${status}: ${count} vehicles across ${pagesProcessed} pages, ${errors.length} errors`,
    );
    return {
      source: "pyp" as const,
      status,
      cursor,
      count,
      errors,
      pagesProcessed,
    };
  });
}

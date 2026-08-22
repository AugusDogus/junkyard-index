import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  streamPullNSaveInventoryWithRequestGate,
  type PullNSaveStreamResult,
} from "./pullnsave-connector";
import type { ProviderRequestGate } from "./provider-http-client";
import type { PullNSaveCanonicalVehicle } from "./pullnsave-transform";

const originalFetch = globalThis.fetch;
const noRateLimit: ProviderRequestGate = (request) => request;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function loadFixtureRows(fileName: string): Promise<unknown[]> {
  const text = await Bun.file(
    new URL(`./fixtures/${fileName}`, import.meta.url),
  ).text();
  return JSON.parse(text) as unknown[];
}

function mockSearch(pages: Map<number, unknown[]>) {
  const requestedBodies: Array<string | null> = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      if (url.pathname !== "/v1/Vehicles/Search") {
        return new Response("not found", { status: 404 });
      }
      const rawBody = init?.body;
      const body = typeof rawBody === "string" ? rawBody : null;
      requestedBodies.push(body);
      const parsed =
        body !== null ? (JSON.parse(body) as Record<string, unknown>) : {};
      const pageNumber = Number(parsed.pageNumber ?? 1);
      const records = pages.get(pageNumber);
      return new Response(JSON.stringify(records ?? []), { status: 200 });
    },
    { preconnect: originalFetch.preconnect },
  );
  return requestedBodies;
}

describe("Pull-N-Save catalog streaming", () => {
  test("streams full pages then completes on a short page", async () => {
    const page1 = await loadFixtureRows("pullnsave-search-page1.json");
    const shortPage = await loadFixtureRows(
      "pullnsave-search-mixed-yards.json",
    );
    const requestedBodies = mockSearch(
      new Map([
        [1, page1],
        [2, shortPage],
      ]),
    );

    const batches: PullNSaveCanonicalVehicle[][] = [];
    const result = await Effect.runPromise(
      streamPullNSaveInventoryWithRequestGate(
        {
          onBatch: (vehicles) =>
            Effect.sync(() => {
              batches.push(vehicles);
            }),
        },
        noRateLimit,
      ),
    );

    expect(requestedBodies).toEqual([
      JSON.stringify({ pageNumber: 1, pageSize: 100 }),
      JSON.stringify({ pageNumber: 2, pageSize: 100 }),
    ]);
    // The short page holds 18 rows: 2 from unlisted yard 8 are skipped and
    // 2 duplicate store-1 VINs already seen on page 1 are dropped.
    expect(result).toMatchObject({
      source: "pullnsave",
      status: "complete",
      cursor: 3,
      count: 114,
      errors: [],
      pagesProcessed: 2,
    });
    expect(batches).toHaveLength(2);
    expect(batches.flat()).toHaveLength(114);
    expect(new Set(batches.flat().map((v) => v.vin)).size).toBe(114);
    expect(
      batches
        .flat()
        .every((vehicle) => vehicle.locationCode.startsWith("PNS-")),
    ).toBe(true);
  });

  test("pauses at a durable page boundary and resumes from the cursor", async () => {
    const page1 = await loadFixtureRows("pullnsave-search-page1.json");
    const shortPage = await loadFixtureRows(
      "pullnsave-search-mixed-yards.json",
    );

    mockSearch(
      new Map([
        [1, page1],
        [2, shortPage],
      ]),
    );

    const paused = await Effect.runPromise(
      streamPullNSaveInventoryWithRequestGate(
        { onBatch: () => Effect.void, maxPages: 1 },
        noRateLimit,
      ),
    );
    expect(paused).toMatchObject({
      status: "paused",
      cursor: 2,
      count: 100,
      pagesProcessed: 1,
    });

    const resumed: PullNSaveStreamResult = await Effect.runPromise(
      streamPullNSaveInventoryWithRequestGate(
        {
          onBatch: () => Effect.void,
          startCursor: paused.cursor,
        },
        noRateLimit,
      ),
    );
    // A resumed run starts with a fresh dedupe map, so all 16 non-unlisted
    // rows on the short page are emitted again.
    expect(resumed).toMatchObject({
      status: "complete",
      cursor: 3,
      count: 16,
      pagesProcessed: 1,
    });
  });

  test("dedupes VINs across pages", async () => {
    const page1 = await loadFixtureRows("pullnsave-search-page1.json");
    const duplicatedFirstRow = {
      ...(page1[0] as object),
      vehicleRno: 999999,
      stockId: "STK999998-1",
    };
    mockSearch(
      new Map([
        [1, page1],
        [2, [duplicatedFirstRow]],
      ]),
    );

    const result = await Effect.runPromise(
      streamPullNSaveInventoryWithRequestGate(
        { onBatch: () => Effect.void },
        noRateLimit,
      ),
    );

    expect(result.status).toBe("complete");
    expect(result.count).toBe(100);
    expect(result.pagesProcessed).toBe(2);
  });

  test("skips rows for unlisted yards and malformed vehicles", async () => {
    const unlistedYardRow = {
      astStoreNumber: 8,
      vehicleRno: 5784,
      storeRno: 1,
      stockId: "STK004686-8",
      rcvdDtTm: "2023-12-13T12:40:00",
      vin: "1G6VS3388LU125931",
      year: 1990,
      make: "CADILLAC",
      model: "ALLANTE",
      color: "RED",
      transmissionDesc: null,
      engineDesc: null,
      yardRow: 25,
    };
    const missingVinRow = {
      ...unlistedYardRow,
      astStoreNumber: 1,
      stockId: "STK999999-1",
      vin: null,
    };
    mockSearch(new Map([[1, [unlistedYardRow, missingVinRow]]]));

    const result = await Effect.runPromise(
      streamPullNSaveInventoryWithRequestGate(
        { onBatch: () => Effect.void },
        noRateLimit,
      ),
    );

    expect(result.status).toBe("complete");
    expect(result.count).toBe(0);
    expect(result.cursor).toBe(2);
    expect(result.pagesProcessed).toBe(1);
  });
});

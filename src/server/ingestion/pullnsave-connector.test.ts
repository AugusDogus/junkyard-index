import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  streamPullNSaveInventoryWithRequestGate,
  type PullNSaveStreamResult,
} from "./pullnsave-connector";
import type { ProviderRequestGate } from "./provider-http-client";
import type { PullNSaveCanonicalVehicle } from "./pullnsave-transform";
import type { Yard } from "~/lib/yard";
import { connectorChunkMetrics } from "./connector-chunk";
import { validateSourceSnapshot } from "./source-validation";

const originalFetch = globalThis.fetch;
const noRateLimit: ProviderRequestGate = (request) => request;
const yardListHtml = await Bun.file(
  new URL("./fixtures/pullnsave-yard-list.html", import.meta.url),
).text();

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function loadFixtureRows(fileName: string): Promise<unknown[]> {
  const text = await Bun.file(
    new URL(`./fixtures/${fileName}`, import.meta.url),
  ).text();
  return JSON.parse(text) as unknown[];
}

function mockSearch(pages: Map<number, unknown[]>, directory = yardListHtml) {
  const requestedBodies: Array<string | null> = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      if (url.pathname === "/inventory/") return new Response(directory);
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
  test("excludes unlisted yards without preserving their VINs or rejecting listed inventory", async () => {
    mockSearch(
      new Map([
        [
          1,
          [
            {
              astStoreNumber: 99,
              stockId: "STK-NEW-YARD",
              vin: "1G1JF52F437297781",
              year: 2003,
              make: "CHEVROLET",
              model: "CAVALIER",
            },
            {
              astStoreNumber: 1,
              stockId: "STK-KNOWN",
              vin: "2G1WU581769248827",
              year: 2006,
              make: "CHEVROLET",
              model: "IMPALA",
            },
          ],
        ],
      ]),
    );
    const result = await Effect.runPromise(
      streamPullNSaveInventoryWithRequestGate(
        { onBatch: () => Effect.void },
        noRateLimit,
      ),
    );
    expect(result.accounting).toEqual({
      recordsProcessed: 2,
      recordsExcluded: 1,
      recordsRejected: 0,
      duplicateVehicles: 0,
    });
    expect(result.status).toBe("complete");
    expect(result.count).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings?.[0]).toContain("yard 99: skipped 1 vehicles");
    expect(result.observedVins).toEqual([]);
    expect(result.warnings?.[0]).toContain("not listed");
  });
  test("ingests a newly discovered yard alongside the existing yards", async () => {
    mockSearch(
      new Map([
        [
          1,
          [
            {
              astStoreNumber: 10,
              stockId: "STK-NO-YEAR",
              vin: "VIN-NO-YEAR",
              year: null,
              make: "CHEVROLET",
              model: "CAVALIER",
            },
            {
              astStoreNumber: 10,
              stockId: "STK-NEW",
              vin: "1G1JF52F437297781",
              year: 2003,
              make: "CHEVROLET",
              model: "CAVALIER",
            },
          ],
        ],
      ]),
    );
    const inventoryFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/inventory/"))
          return new Response(
            yardListHtml.replace(
              "</select>",
              '<option value="10">New Yard</option></select>',
            ),
          );
        if (url.includes("admin-ajax.php"))
          return new Response(
            JSON.stringify({
              success: true,
              data: [
                {
                  astStoreNumber: 10,
                  yardName: "New Yard",
                  yardAddress: "100 Main St, Mesa, AZ",
                  yardZip: "85201",
                },
              ],
            }),
          );
        if (url.includes("zippopotam.us"))
          return new Response(
            JSON.stringify({
              places: [
                {
                  latitude: "33.43",
                  longitude: "-111.85",
                  "place name": "Mesa",
                  state: "Arizona",
                  "state abbreviation": "AZ",
                },
              ],
            }),
          );
        return inventoryFetch(input, init);
      },
      { preconnect: originalFetch.preconnect },
    );
    const vehicles: PullNSaveCanonicalVehicle[] = [];
    const yards: Yard[] = [];
    const result = await Effect.runPromise(
      streamPullNSaveInventoryWithRequestGate(
        {
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles.push(...batch);
            }),
          onYards: (batch) =>
            Effect.sync(() => {
              yards.push(...batch);
            }),
        },
        noRateLimit,
      ),
    );
    expect(result).toMatchObject({
      status: "complete",
      count: 1,
      errors: [],
      warnings: [],
    });
    expect(result.accounting).toMatchObject({
      recordsExcluded: 0,
      recordsRejected: 1,
    });
    expect(vehicles[0]).toMatchObject({
      vin: "1G1JF52F437297781",
      locationCode: "PNS-10",
      locationName: "New Yard",
      locationCity: "Mesa",
      stateAbbr: "AZ",
    });
    expect(yards.find((yard) => yard.code === "PNS-10")).toMatchObject({
      name: "New Yard",
      address: "100 Main St",
      lat: null,
      lng: null,
    });
  });
  test.each(["rejected", "duplicate"] as const)(
    "preserves %s counts through resumable chunks and fails snapshot validation",
    async (kind) => {
      const pages = new Map<number, unknown[]>();
      for (let page = 1; page <= 120; page++) {
        pages.set(
          page,
          Array.from({ length: 100 }, (_, index) => ({
            astStoreNumber: 1,
            vehicleRno: page * 100 + index,
            storeRno: 1,
            stockId: `stock-${page}-${index}`,
            year: 2000,
            make: "FORD",
            model: "FOCUS",
            vin:
              kind === "rejected" && index >= 80
                ? null
                : `VIN-${page}-${kind === "duplicate" ? index % 60 : index}`,
          })),
        );
      }
      mockSearch(pages);
      const vins = new Set<string>();
      let cursor = 1;
      let vehiclesProcessed = 0;
      let duplicateVehicles = 0;
      let rejectedVehicles = 0;
      while (true) {
        const chunkVins = new Set<string>();
        const result = await Effect.runPromise(
          streamPullNSaveInventoryWithRequestGate(
            {
              startCursor: cursor,
              maxPages: 10,
              onBatch: (batch) =>
                Effect.sync(() => {
                  for (const vehicle of batch) {
                    chunkVins.add(vehicle.vin);
                    vins.add(vehicle.vin);
                  }
                }),
            },
            noRateLimit,
          ),
        );
        const metrics = connectorChunkMetrics(result, chunkVins.size);
        vehiclesProcessed += metrics.vehiclesProcessed;
        duplicateVehicles += metrics.duplicateVehicles;
        rejectedVehicles += metrics.rejectedVehicles;
        if (result.status === "complete") break;
        cursor = result.cursor;
      }
      const validation = validateSourceSnapshot({
        source: "pullnsave",
        terminal: true,
        uniqueVehicles: vins.size,
        vehiclesProcessed,
        duplicateVehicles,
        rejectedVehicles,
        previousAcceptedCount: 11721,
        errors: [],
      });
      expect(validation.status).toBe("rejected");
      expect(vehiclesProcessed).toBe(12000);
      expect(kind === "rejected" ? rejectedVehicles : duplicateVehicles).toBe(
        kind === "rejected" ? 2400 : 4800,
      );
    },
  );
  test("accepts the terminal empty page when resuming after an exact full page", async () => {
    const page = await loadFixtureRows("pullnsave-search-page1.json");
    mockSearch(new Map([[1, page]]));
    const paused = await Effect.runPromise(
      streamPullNSaveInventoryWithRequestGate(
        {
          onBatch: () => Effect.void,
          maxPages: 1,
        },
        noRateLimit,
      ),
    );
    const terminal = await Effect.runPromise(
      streamPullNSaveInventoryWithRequestGate(
        {
          onBatch: () => Effect.void,
          startCursor: paused.cursor,
        },
        noRateLimit,
      ),
    );
    expect(terminal).toMatchObject({
      status: "complete",
      cursor: 3,
      pagesProcessed: 1,
      count: 0,
    });
  });
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
    const yards: Yard[] = [];
    const result = await Effect.runPromise(
      streamPullNSaveInventoryWithRequestGate(
        {
          onYards: (batch) =>
            Effect.sync(() => {
              yards.push(...batch);
            }),
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
    expect(yards).toHaveLength(8);
    expect(
      yards.every(
        (yard) =>
          yard.source === "pullnsave" && yard.operator === "Pull-N-Save",
      ),
    ).toBe(true);
    expect(
      batches
        .flat()
        .every((vehicle) =>
          yards.some((yard) => yard.code === vehicle.locationCode),
        ),
    ).toBe(true);
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
    expect(result.observedVins).toEqual([]);
    expect(result.cursor).toBe(2);
    expect(result.pagesProcessed).toBe(1);
    expect(result.accounting).toEqual({
      recordsProcessed: 2,
      recordsExcluded: 1,
      recordsRejected: 1,
      duplicateVehicles: 0,
    });
    expect(connectorChunkMetrics(result, 0)).toEqual({
      vehiclesProcessed: 1,
      uniqueVehicles: 0,
      duplicateVehicles: 0,
      rejectedVehicles: 1,
    });
  });
  test("cached known yards cannot override the current public list", async () => {
    const page = await loadFixtureRows("pullnsave-search-page1.json");
    mockSearch(
      new Map([[1, page]]),
      yardListHtml.replace(/<option value="1">[^<]*<\/option>/, ""),
    );
    const yards: Yard[] = [];
    const result = await Effect.runPromise(
      streamPullNSaveInventoryWithRequestGate(
        {
          onBatch: () => Effect.die("Unlisted inventory must not be emitted"),
          onYards: (batch) =>
            Effect.sync(() => {
              yards.push(...batch);
            }),
        },
        noRateLimit,
      ),
    );
    expect(result.count).toBe(0);
    expect(result.accounting?.recordsExcluded).toBe(100);
    expect(result.observedVins).toEqual([]);
    expect(yards.some((yard) => yard.code === "PNS-SLC")).toBe(false);
  });
  test("directory failure stops even resumed chunks before callbacks or inventory requests", async () => {
    const requests: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response("unavailable", { status: 403 });
      },
      { preconnect: originalFetch.preconnect },
    );
    await expect(
      Effect.runPromise(
        streamPullNSaveInventoryWithRequestGate(
          {
            startCursor: 11,
            onBatch: () => Effect.die("unexpected batch"),
            onYards: () => Effect.die("unexpected yard"),
          },
          noRateLimit,
        ),
      ),
    ).rejects.toThrow("403");
    expect(requests).toEqual(["https://www.pullnsave.com/inventory/"]);
  });
});

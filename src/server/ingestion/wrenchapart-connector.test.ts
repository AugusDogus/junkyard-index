import { afterEach, expect, test } from "bun:test";
import { Effect, Either } from "effect";
import fixture from "./fixtures/wrenchapart-sample.json";
import { connectorChunkMetrics } from "./connector-chunk";
import {
  streamWrenchApartInventoryWithRequestGate,
  WrenchApartCursor,
} from "./wrenchapart-connector";
import type { WrenchApartLocation } from "./wrenchapart-client";
import type { ProviderRequestGate } from "./provider-http-client";
import type { WrenchApartCanonicalVehicle } from "./wrenchapart-transform";
import type { WrenchApartYard } from "./wrenchapart-yard-metadata";

const originalFetch = globalThis.fetch;
const noRateLimit: ProviderRequestGate = (request) => request;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockCatalog(
  locations: readonly WrenchApartLocation[],
  records: Map<number, unknown[]>,
) {
  const requestedYards: number[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      if (url.pathname === "/locations") return Response.json(locations);
      const id = Number(url.searchParams.get("locationId"));
      requestedYards.push(id);
      return Response.json(records.get(id) ?? []);
    },
    { preconnect: originalFetch.preconnect },
  );
  return requestedYards;
}

test("resumes by yard ID across directory reordering, additions and removals", async () => {
  const locations = [fixture.location, { ...fixture.location, id: 10 }];
  const records = new Map<number, unknown[]>([
    [2, [fixture.vehicle]],
    [10, [{ ...fixture.vehicle, yard: 10, vin: "VIN-TEN" }]],
    [8, [{ ...fixture.vehicle, yard: 8, vin: "VIN-EIGHT" }]],
  ]);
  const calls = mockCatalog(locations, records);
  const first = await Effect.runPromise(
    streamWrenchApartInventoryWithRequestGate(
      { onBatch: () => Effect.void },
      noRateLimit,
    ),
  );
  expect(first).toMatchObject({
    status: "paused",
    cursor: { source: "wrenchapart", afterLocationId: 2 },
    count: 1,
    pagesProcessed: 1,
  });
  expect(calls).toEqual([2]);
  const resumedCalls = mockCatalog(
    [
      { ...fixture.location, id: 10 },
      { ...fixture.location, id: 8 },
    ],
    records,
  );
  const second = await Effect.runPromise(
    streamWrenchApartInventoryWithRequestGate(
      { startCursor: first.cursor, maxPages: 2, onBatch: () => Effect.void },
      noRateLimit,
    ),
  );
  expect(resumedCalls).toEqual([8, 10]);
  expect(second).toMatchObject({
    status: "complete",
    cursor: { source: "wrenchapart", afterLocationId: 10 },
    count: 2,
    pagesProcessed: 2,
  });
  const terminal = await Effect.runPromise(
    streamWrenchApartInventoryWithRequestGate(
      { startCursor: second.cursor, onBatch: () => Effect.void },
      noRateLimit,
    ),
  );
  expect(terminal).toMatchObject({
    status: "complete",
    count: 0,
    pagesProcessed: 0,
    cursor: second.cursor,
  });
});

test("preserves rejected, duplicate and excluded accounting and unresolved VIN observations", async () => {
  mockCatalog(
    [fixture.location, { id: 99 }],
    new Map([
      [
        2,
        [
          fixture.vehicle,
          fixture.vehicle,
          { ...fixture.vehicle, vin: "NO-YEAR", modelYear: null },
        ],
      ],
      [99, [{ ...fixture.vehicle, yard: 99, vin: " observed-vin " }]],
    ]),
  );
  const vehicles: WrenchApartCanonicalVehicle[] = [];
  const yards: WrenchApartYard[] = [];
  const result = await Effect.runPromise(
    streamWrenchApartInventoryWithRequestGate(
      {
        maxPages: 2,
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
  expect(vehicles).toHaveLength(1);
  expect(yards.map((yard) => yard.code)).toEqual(["2"]);
  expect(result).toMatchObject({
    status: "complete",
    count: 1,
    observedVins: ["OBSERVED-VIN"],
    errors: [],
    accounting: {
      recordsProcessed: 4,
      recordsRejected: 1,
      recordsExcluded: 1,
      duplicateVehicles: 1,
    },
  });
  expect(result.warnings?.[0]).toContain("yard 99: skipped 1 vehicles");
  expect(connectorChunkMetrics(result, vehicles.length)).toEqual({
    vehiclesProcessed: 3,
    uniqueVehicles: 1,
    duplicateVehicles: 1,
    rejectedVehicles: 1,
  });
});

test("emits yard metadata but excludes vehicles when real coordinates are missing", async () => {
  mockCatalog(
    [{ ...fixture.location, geoLat: null }],
    new Map([[2, [fixture.vehicle]]]),
  );
  const yards: WrenchApartYard[] = [];
  const result = await Effect.runPromise(
    streamWrenchApartInventoryWithRequestGate(
      {
        onBatch: () => Effect.die("Must not fabricate coordinates"),
        onYards: (batch) =>
          Effect.sync(() => {
            yards.push(...batch);
          }),
      },
      noRateLimit,
    ),
  );
  expect(yards[0]).toMatchObject({ code: "2", lat: null, lng: null });
  expect(result).toMatchObject({
    count: 0,
    observedVins: [fixture.vehicle.vin],
    accounting: { recordsExcluded: 1, recordsRejected: 0 },
  });
});

test("never slices inventory inside a yard and preserves stable VIN identity", async () => {
  const records = Array.from({ length: 2400 }, (_, i) => ({
    ...fixture.vehicle,
    vin: `PROVIDER-VIN-${i}`,
    stockNumber: "SAME-STOCK",
  }));
  mockCatalog([fixture.location], new Map([[2, records]]));
  let size = 0;
  const result = await Effect.runPromise(
    streamWrenchApartInventoryWithRequestGate(
      {
        onBatch: (batch) =>
          Effect.sync(() => {
            size += batch.length;
          }),
      },
      noRateLimit,
    ),
  );
  expect(size).toBe(2400);
  expect(result).toMatchObject({
    status: "complete",
    count: 2400,
    pagesProcessed: 1,
    accounting: { recordsProcessed: 2400 },
  });
});

test("an empty yard does not stop subsequent yards", async () => {
  mockCatalog(
    [fixture.location, { ...fixture.location, id: 9 }],
    new Map([[9, [{ ...fixture.vehicle, yard: 9 }]]]),
  );
  const result = await Effect.runPromise(
    streamWrenchApartInventoryWithRequestGate(
      { maxPages: 2, onBatch: () => Effect.void },
      noRateLimit,
    ),
  );
  expect(result).toMatchObject({
    status: "complete",
    count: 1,
    pagesProcessed: 2,
    cursor: { afterLocationId: 9 },
  });
});

test.each([
  { locations: [] },
  { locations: [fixture.location, fixture.location] },
])(
  "fails a missing or ambiguous directory before inventory callbacks",
  async ({ locations }) => {
    const calls = mockCatalog(locations, new Map());
    const result = await Effect.runPromise(
      Effect.either(
        streamWrenchApartInventoryWithRequestGate(
          { onBatch: () => Effect.die("Unexpected callback") },
          noRateLimit,
        ),
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    expect(calls).toEqual([]);
  },
);

test("fails when locationId filtering is ignored instead of silently excluding other yards", async () => {
  mockCatalog(
    [fixture.location],
    new Map([[2, [fixture.vehicle, { ...fixture.vehicle, yard: 10 }]]]),
  );
  const result = await Effect.runPromise(
    Effect.either(
      streamWrenchApartInventoryWithRequestGate(
        { onBatch: () => Effect.die("Unexpected callback") },
        noRateLimit,
      ),
    ),
  );
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isLeft(result))
    expect(result.left.message).toContain("filter contract changed");
});

test("propagates a failed batch and allows replay from the unchanged caller cursor", async () => {
  const calls = mockCatalog(
    [fixture.location],
    new Map([[2, [fixture.vehicle]]]),
  );
  const cursor = { ...WrenchApartCursor.initial };
  const failed = await Effect.runPromise(
    Effect.either(
      streamWrenchApartInventoryWithRequestGate(
        {
          startCursor: cursor,
          onBatch: () => Effect.fail("checkpoint failed"),
        },
        noRateLimit,
      ),
    ),
  );
  expect(failed).toEqual(Either.left("checkpoint failed"));
  expect(cursor).toEqual(WrenchApartCursor.initial);
  const result = await Effect.runPromise(
    streamWrenchApartInventoryWithRequestGate(
      { startCursor: cursor, onBatch: () => Effect.void },
      noRateLimit,
    ),
  );
  expect(result.count).toBe(1);
  expect(calls).toEqual([2, 2]);
});

test.each([0, -1, 1.5, Infinity])(
  "rejects invalid maxPages=%p instead of returning false completion",
  async (maxPages) => {
    const calls = mockCatalog([fixture.location], new Map());
    const result = await Effect.runPromise(
      Effect.either(
        streamWrenchApartInventoryWithRequestGate(
          { maxPages, onBatch: () => Effect.void },
          noRateLimit,
        ),
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    expect(calls).toEqual([]);
  },
);

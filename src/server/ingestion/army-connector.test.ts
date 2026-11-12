import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamArmyInventoryWithRequestGate } from "./army-connector";
import { ArmyCursor, ArmyCursorSchema } from "./army-cursor";
import {
  armyTestPage,
  armyTestRecord,
  armyTestRow,
} from "./army-test-fixtures";
import type { ArmyCanonicalVehicle } from "./army-transform";
import { ARMY_INVENTORY_URL, ARMY_YARD } from "./army-yard-metadata";
import { soakArmyInventory } from "../../../scripts/soak-army";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;

function mockInventory(
  body = armyTestPage(),
  response?: (body: string) => Response,
) {
  let requests = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(ARMY_INVENTORY_URL);
      requests++;
      return (
        response?.(body) ??
        new Response(body, {
          headers: { "content-type": "text/html; charset=UTF-8" },
        })
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return () => requests;
}

test("Army completes one validated catalog and emits exact physical yard metadata", async () => {
  const requests = mockInventory();
  const vehicles: ArmyCanonicalVehicle[] = [];
  const yards: (typeof ARMY_YARD)[] = [];
  const result = await Effect.runPromise(
    streamArmyInventoryWithRequestGate(
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
      gate,
    ),
  );
  expect(requests()).toBe(1);
  expect(result).toMatchObject({
    source: "army",
    status: "complete",
    cursor: { source: "army", phase: "complete" },
    count: 1,
    pagesProcessed: 1,
    accounting: {
      recordsProcessed: 1,
      recordsRejected: 0,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    },
  });
  expect(vehicles[0]?.vin).toBe(armyTestRecord.vin);
  expect(yards).toEqual([ARMY_YARD]);
});

const responseBoundaries: ResponseInit[] = [
  { status: 206, headers: { "content-type": "text/html" } },
  {
    status: 200,
    headers: { "content-type": "text/html", "content-range": "bytes 0-10/100" },
  },
  { status: 403, headers: { "content-type": "text/html" } },
  { status: 429, headers: { "content-type": "text/html" } },
  { status: 503, headers: { "content-type": "text/html" } },
  { status: 200, headers: { "content-type": "application/json" } },
  {
    status: 200,
    headers: { "content-type": "text/html", "content-length": "1" },
  },
  {
    status: 200,
    headers: { "content-type": "text/html", "content-length": "5000000" },
  },
];
test.each(responseBoundaries)(
  "Army rejects HTTP/body boundaries once before callbacks (%#)",
  async (init) => {
    const requests = mockInventory(
      armyTestPage(),
      (body) => new Response(body, init),
    );
    let callbacks = 0;
    const callback = () =>
      Effect.sync(() => {
        callbacks++;
      });
    await expect(
      Effect.runPromise(
        streamArmyInventoryWithRequestGate(
          { onBatch: callback, onYards: callback },
          gate,
        ),
      ),
    ).rejects.toThrow("previous inventory is preserved");
    expect(callbacks).toBe(0);
    expect(requests()).toBe(1);
  },
);

test("Army blocks redirects, invalid UTF-8, broken bodies and network failures without retrying", async () => {
  const responses: readonly ((body: string) => Response)[] = [
    (body) => {
      const response = new Response(body, {
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "url", { value: "https://example.com/" });
      return response;
    },
    () =>
      new Response(new Uint8Array([0xc3, 0x28]), {
        headers: { "content-type": "text/html" },
      }),
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("Broken body"));
          },
        }),
        { headers: { "content-type": "text/html" } },
      ),
    () => {
      throw new Error("Network failure");
    },
  ];
  for (const response of responses) {
    const requests = mockInventory(armyTestPage(), response);
    let callbacks = 0;
    await expect(
      Effect.runPromise(
        streamArmyInventoryWithRequestGate(
          {
            onBatch: () =>
              Effect.sync(() => {
                callbacks++;
              }),
          },
          gate,
        ),
      ),
    ).rejects.toThrow("previous inventory is preserved");
    expect(requests()).toBe(1);
    expect(callbacks).toBe(0);
  }
});

function records(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ...armyTestRecord,
    id: String(1000 + index),
    stock: String(10000 + index).padStart(12, "0"),
    vin: "WBXPA93465W" + String(100000 + index),
  }));
}

test("Army accepts exactly 10% rejected rows and preserves rejected valid identities", async () => {
  const rows = records(10).map((record, index) =>
    index === 0 ? { ...record, model: "" } : record,
  );
  mockInventory(armyTestPage(rows.map(armyTestRow).join("")));
  const result = await Effect.runPromise(
    streamArmyInventoryWithRequestGate({ onBatch: () => Effect.void }, gate),
  );
  expect(result).toMatchObject({
    count: 9,
    observedVins: [rows[0]?.vin],
    accounting: {
      recordsProcessed: 10,
      recordsRejected: 1,
      duplicateVehicles: 0,
    },
  });
});

test("Army blocks rejection above 10% and contradictory identity metadata before callbacks", async () => {
  const base = records(10);
  const cases = [
    base.map((record, index) =>
      index < 2 ? { ...record, model: "" } : record,
    ),
    [
      ...base,
      { ...armyTestRecord, id: "2000", vin: base[0]?.vin ?? "", year: "2006" },
    ],
    [...base, { ...armyTestRecord, id: "2000", stock: base[0]?.stock ?? "" }],
  ];
  for (const rows of cases) {
    mockInventory(armyTestPage(rows.map(armyTestRow).join("")));
    let callbacks = 0;
    const callback = () =>
      Effect.sync(() => {
        callbacks++;
      });
    await expect(
      Effect.runPromise(
        streamArmyInventoryWithRequestGate(
          { onBatch: callback, onYards: callback },
          gate,
        ),
      ),
    ).rejects.toThrow("previous inventory is preserved");
    expect(callbacks).toBe(0);
  }
});

test("Army deduplicates at the 25% boundary and blocks larger duplicate ratios", async () => {
  const base = records(3);
  const first = base[0];
  if (!first) throw new Error("Missing test donor");
  const duplicate = { ...first, id: "2000" };
  mockInventory(armyTestPage([...base, duplicate].map(armyTestRow).join("")));
  const result = await Effect.runPromise(
    streamArmyInventoryWithRequestGate({ onBatch: () => Effect.void }, gate),
  );
  expect(result).toMatchObject({
    count: 3,
    accounting: { recordsProcessed: 4, duplicateVehicles: 1 },
  });
  mockInventory(
    armyTestPage(
      [...base, duplicate, { ...duplicate, id: "2001" }]
        .map(armyTestRow)
        .join(""),
    ),
  );
  await expect(
    Effect.runPromise(
      streamArmyInventoryWithRequestGate(
        { onBatch: () => Effect.die("Unexpected callback") },
        gate,
      ),
    ),
  ).rejects.toThrow("25% duplicate limit");
});

test("Army malformed snapshots never call batch or yard callbacks", async () => {
  mockInventory(armyTestPage().replace("</tbody>", ""));
  let callbacks = 0;
  const callback = () =>
    Effect.sync(() => {
      callbacks++;
    });
  await expect(
    Effect.runPromise(
      streamArmyInventoryWithRequestGate(
        { onBatch: callback, onYards: callback },
        gate,
      ),
    ),
  ).rejects.toThrow("previous inventory is preserved");
  expect(callbacks).toBe(0);
});

test("Army ignores unusable optional stocks when checking donor contradictions", async () => {
  const rows = records(3).map((record) => ({ ...record, stock: "N/A" }));
  mockInventory(armyTestPage(rows.map(armyTestRow).join("")));
  const result = await Effect.runPromise(
    streamArmyInventoryWithRequestGate({ onBatch: () => Effect.void }, gate),
  );
  expect(result).toMatchObject({
    count: 3,
    accounting: { recordsProcessed: 3, recordsRejected: 0 },
  });
});

test("Army soak counts one complete memory-only catalog and bounds its request budget", async () => {
  mockInventory();
  const budgets: number[] = [];
  const runChunk = (startCursor: ArmyCursor, maxPages: number) => {
    budgets.push(maxPages);
    return Effect.runPromise(
      streamArmyInventoryWithRequestGate(
        { startCursor, maxPages, onBatch: () => Effect.void },
        gate,
      ),
    );
  };
  expect(await soakArmyInventory(runChunk, 100)).toMatchObject({
    count: 1,
    pagesProcessed: 1,
    status: "complete",
  });
  expect(budgets).toEqual([32]);
  await expect(soakArmyInventory(runChunk, 0)).rejects.toThrow(
    "positive integer",
  );
});

test("Army validates cursors and page budgets before requesting and completes idempotently", async () => {
  const requests = mockInventory();
  expect(
    ArmyCursorSchema.safeParse({ ...ArmyCursor.initial, page: 2 }).success,
  ).toBe(false);
  expect(
    ArmyCursorSchema.safeParse({ source: "other", phase: "start" }).success,
  ).toBe(false);
  for (const maxPages of [0, -1, 1.5, 33, NaN]) {
    await expect(
      Effect.runPromise(
        streamArmyInventoryWithRequestGate(
          { maxPages, onBatch: () => Effect.void },
          gate,
        ),
      ),
    ).rejects.toThrow("cursor or page budget");
  }
  const result = await Effect.runPromise(
    streamArmyInventoryWithRequestGate(
      {
        startCursor: { source: "army", phase: "complete" },
        onBatch: () => Effect.die("Unexpected callback"),
      },
      gate,
    ),
  );
  expect(result).toMatchObject({
    count: 0,
    pagesProcessed: 0,
    status: "complete",
  });
  expect(requests()).toBe(0);
});

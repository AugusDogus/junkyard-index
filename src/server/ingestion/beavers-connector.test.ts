import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamBeaversInventoryWithRequestGate } from "./beavers-connector";
import { BeaversCursor } from "./beavers-cursor";
import { beaversTestCatalog, beaversTestDetail } from "./beavers-test-fixtures";
import type { BeaversVehicle } from "./beavers-transform";
import {
  beaversDetailUrl,
  beaversDonorId,
  beaversPage,
} from "./beavers-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const direct = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
function mockInventory(
  options: {
    drift?: boolean;
    optionalStockDrift?: boolean;
    rejects?: number;
  } = {},
) {
  const requests: string[] = [];
  const reads = new Map<number, number>();
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push(url);
      expect(init?.redirect).toBe("manual");
      const headers = { "content-type": "text/html" };
      const page = beaversPage(url);
      if (page !== null) {
        const times = (reads.get(page) ?? 0) + 1;
        reads.set(page, times);
        let html = beaversTestCatalog(page);
        if (page === 2 && times > 1) {
          if (options.drift) html = html.replaceAll("MDX", "RDX");
          if (options.optionalStockDrift)
            html = html.replace("260020", "changed");
        }
        return new Response(html, { headers });
      }
      if (beaversDonorId(url, "route"))
        return new Response("redirect", {
          status: 302,
          headers: { ...headers, location: beaversDetailUrl(url) },
        });
      const id = beaversDonorId(url, "detail");
      if (!id) throw new Error("Unexpected test donor request");
      const index = Number(id) - 10000000;
      return new Response(
        beaversTestDetail(index, index < (options.rejects ?? 1)),
        { headers },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
async function collect(previousAcceptedCount: number | null = null) {
  let cursor: BeaversCursor = BeaversCursor.initial;
  let yards = 0,
    steps = 0,
    chunks = 0;
  const batches: BeaversVehicle[][] = [];
  while (chunks++ < 30) {
    const before = BeaversCursor.serialize(cursor);
    const result = await Effect.runPromise(
      streamBeaversInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages: 32,
          previousAcceptedCount,
          onYards: (values) =>
            Effect.sync(() => {
              yards += values.length;
            }),
          onBatch: (values) =>
            Effect.sync(() => {
              batches.push(values);
            }),
        },
        direct,
      ),
    );
    expect(BeaversCursor.serialize(cursor)).toBe(before);
    steps += result.pagesProcessed;
    if (result.status === "complete") return { result, batches, yards, steps };
    expect(result.count).toBe(0);
    expect(batches).toHaveLength(0);
    expect(yards).toBe(0);
    cursor = BeaversCursor.parse(BeaversCursor.serialize(result.cursor));
  }
  throw new Error("Test inventory failed to terminate");
}
test("donors and yard emit once after every opening, redirect, detail and closing control, across resumes", async () => {
  const requests = mockInventory();
  const { result, batches, yards, steps } = await collect();
  expect(result.count).toBe(259);
  expect(result.accounting).toEqual({
    recordsProcessed: 260,
    recordsRejected: 1,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  expect(result.observedVins).toEqual(["5J8YD3H36JL100000"]);
  expect(steps).toBe(546);
  expect(requests).toHaveLength(546);
  expect(batches).toHaveLength(1);
  expect(yards).toBe(1);
  const terminal = await Effect.runPromise(
    streamBeaversInventoryWithRequestGate(
      {
        startCursor: result.cursor,
        onBatch: () => Effect.die("Terminal replay emitted"),
      },
      direct,
    ),
  );
  expect(terminal.pagesProcessed).toBe(0);
  expect(requests).toHaveLength(546);
});
// Replaying several full saved censuses can exceed five seconds in CI.
test("closing required-membership drift, excessive rejects and previous-run collapse never emit", async () => {
  for (const scenario of [
    {
      options: { drift: true },
      previous: null,
      message: "closing required donor",
    },
    { options: { rejects: 27 }, previous: null, message: "10%" },
    { options: {}, previous: 600, message: "50%" },
  ]) {
    mockInventory(scenario.options);
    await expect(collect(scenario.previous)).rejects.toThrow(scenario.message);
  }
}, 15_000);
test("optional closing stock changes become null and preserve source admission", async () => {
  mockInventory({ optionalStockDrift: true });
  const { batches, result } = await collect();
  expect(result.count).toBe(259);
  expect(
    batches.flat().find((vehicle) => vehicle.vin === "5J8YD3H36JL100020")
      ?.stockNumber,
  ).toBeNull();
});
test("invalid durable chunk sizes and corrupt checkpoints fail before any request", async () => {
  const requests = mockInventory();
  for (const maxPages of [0, 33, NaN])
    await expect(
      Effect.runPromise(
        streamBeaversInventoryWithRequestGate(
          { maxPages, onBatch: () => Effect.die("Invalid chunk emitted") },
          direct,
        ),
      ),
    ).rejects.toThrow("chunk size");
  await expect(
    Effect.runPromise(
      streamBeaversInventoryWithRequestGate(
        {
          startCursor: { ...BeaversCursor.initial, checksum: "changed" },
          onBatch: () => Effect.die("Corrupt cursor emitted"),
        },
        direct,
      ),
    ),
  ).rejects.toThrow("checksum");
  expect(requests).toHaveLength(0);
});

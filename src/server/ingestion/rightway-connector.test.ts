import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamRightwayInventoryWithRequestGate } from "./rightway-connector";
import { RightwayCursor, RightwayCursorSchema } from "./rightway-cursor";
import type { RightwayRecord } from "./rightway-parser";
import type { RightwayCanonicalVehicle } from "./rightway-transform";
import {
  rightwayTestHome,
  rightwayTestPage,
  rightwayTestRecord,
  rightwayTestRow,
  rightwayTestScript,
} from "./rightway-test-fixtures";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect;
const scriptPath =
  "/wp-content/plugins/wp-inventory-manager/js/wpinventory.js?ver=2.5.10";

function mockInventory(
  options: {
    records?: readonly RightwayRecord[];
    rewrite?: (body: string, path: string) => string;
    response?: (body: string, path: string) => Response;
  } = {},
) {
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.origin).toBe("https://rightwayautorecycling.com");
      const path = url.pathname + url.search;
      requests.push(path);
      const raw =
        path === "/"
          ? rightwayTestHome
          : path === "/vehicle-search/"
            ? rightwayTestPage(
                (options.records ?? [rightwayTestRecord])
                  .map(rightwayTestRow)
                  .join(""),
              )
            : path === scriptPath
              ? rightwayTestScript
              : undefined;
      if (raw === undefined)
        throw new Error("Unexpected Rightway request " + path);
      const body = options.rewrite?.(raw, path) ?? raw;
      return (
        options.response?.(body, path) ??
        new Response(body, {
          headers: {
            "content-type":
              path === scriptPath ? "application/javascript" : "text/html",
          },
        })
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
const run = (
  onBatch = (_batch: RightwayCanonicalVehicle[]) => Effect.void,
  startCursor?: RightwayCursor,
  maxPages = 1,
) =>
  Effect.runPromise(
    streamRightwayInventoryWithRequestGate(
      { onBatch, startCursor, maxPages },
      gate,
    ),
  );

test("Rightway accepts one complete catalog only after all native controls pass", async () => {
  const requests = mockInventory();
  const vehicles: RightwayCanonicalVehicle[] = [];
  const result = await run((batch) =>
    Effect.sync(() => {
      vehicles.push(...batch);
    }),
  );
  expect(requests).toEqual(["/", "/vehicle-search/", scriptPath]);
  expect(result).toMatchObject({
    source: "rightway",
    status: "complete",
    count: 1,
    pagesProcessed: 1,
    cursor: { source: "rightway", phase: "complete" },
    accounting: {
      recordsProcessed: 1,
      recordsRejected: 0,
      duplicateVehicles: 0,
    },
  });
  expect(vehicles[0]?.vin).toBe(rightwayTestRecord.vin);
  expect(vehicles[0]?.pricesUrl).toBe(
    "https://rightwayautorecycling.com/price-list/",
  );
});

test.each([
  (body: string, path: string) =>
    path === "/" ? body.replace("38329", "38330") : body,
  (body: string, path: string) =>
    path === "/vehicle-search/" ? body.replace("</tbody>", "") : body,
  (body: string, path: string) => (path === scriptPath ? body + "\n" : body),
])(
  "Rightway blocks callbacks for changed ownership, structure or pagination (%#)",
  async (rewrite) => {
    mockInventory({ rewrite });
    let callbacks = 0;
    await expect(
      Effect.runPromise(
        streamRightwayInventoryWithRequestGate(
          {
            onBatch: () =>
              Effect.sync(() => {
                callbacks++;
              }),
            onYards: () =>
              Effect.sync(() => {
                callbacks++;
              }),
          },
          gate,
        ),
      ),
    ).rejects.toThrow("previous inventory is preserved");
    expect(callbacks).toBe(0);
  },
);

const responseBoundaries: ResponseInit[] = [
  { status: 206, headers: { "content-type": "text/html" } },
  { status: 200, headers: { "content-type": "application/json" } },
  {
    status: 200,
    headers: { "content-type": "text/html", "content-range": "bytes 0-10/100" },
  },
  {
    status: 200,
    headers: { "content-type": "text/html", "content-length": "1" },
  },
  { status: 403, headers: { "content-type": "text/html" } },
];
test.each(responseBoundaries)(
  "Rightway rejects incomplete or unexpected responses (%#)",
  async (init) => {
    mockInventory({ response: (body) => new Response(body, init) });
    await expect(run()).rejects.toThrow("previous inventory is preserved");
  },
);

test("Rightway rejects redirects and HTML served as the pagination script", async () => {
  mockInventory({
    response: (body) => {
      const response = new Response(body, {
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "url", {
        value: "https://other.example/",
      });
      return response;
    },
  });
  await expect(run()).rejects.toThrow("verified MIME and destination");
  mockInventory({
    response: (body) =>
      new Response(body, { headers: { "content-type": "text/html" } }),
  });
  await expect(run()).rejects.toThrow("verified MIME and destination");
});

test("Rightway returns no completed checkpoint when its batch callback fails", async () => {
  mockInventory();
  await expect(
    Effect.runPromise(
      streamRightwayInventoryWithRequestGate(
        {
          onBatch: () => Effect.fail(new Error("Local batch write failed")),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("Local batch write failed");
});

test("Rightway keeps a missing optional price-list link null", async () => {
  mockInventory({
    rewrite: (body, path) =>
      path === "/"
        ? body.replace(
            '<a href="https://rightwayautorecycling.com/price-list/">Price List</a>',
            "",
          )
        : body,
  });
  const vehicles: RightwayCanonicalVehicle[] = [];
  await run((batch) =>
    Effect.sync(() => {
      vehicles.push(...batch);
    }),
  );
  expect(vehicles[0]?.pricesUrl).toBeNull();
});

function records(count: number): RightwayRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    ...rightwayTestRecord,
    nativeUrl:
      "https://rightwayautorecycling.com/vehicle-search/?inventory_id=" +
      (556 + index),
    stock: "01-" + (index + 1) + "-25",
    vin: "1FADP3F29EL" + String(130149 + index),
  }));
}

test.each(["stock", "vin", "nativeUrl"] as const)(
  "Rightway blocks duplicate %s identities",
  async (field) => {
    const rows = records(2).map((row) => ({
      ...row,
      [field]: rightwayTestRecord[field],
    }));
    mockInventory({ records: rows });
    await expect(run()).rejects.toThrow("duplicate");
  },
);

test("Rightway keeps valid presence for rejected YMM and enforces ten percent before callbacks", async () => {
  const rows = records(10).map((row, index) =>
    index === 9 ? { ...row, model: "Unknown" } : row,
  );
  mockInventory({ records: rows });
  const result = await run();
  expect(result.count).toBe(9);
  expect(result.observedVins).toEqual(["1FADP3F29EL130158"]);
  mockInventory({
    records: rows.map((row, index) =>
      index === 8 ? { ...row, model: "Unknown" } : row,
    ),
  });
  let emitted = false;
  await expect(
    run(() =>
      Effect.sync(() => {
        emitted = true;
      }),
    ),
  ).rejects.toThrow("10% rejection limit");
  expect(emitted).toBe(false);
});

test("Rightway admits stockless donors and validates checkpoint budgets before requests", async () => {
  mockInventory({
    records: records(2).map((row) => ({
      ...row,
      stock: "",
      color: "",
      dateAdded: "",
    })),
  });
  expect((await run()).count).toBe(2);
  const requests = mockInventory();
  await expect(run(undefined, undefined, 0)).rejects.toThrow("checkpoint");
  expect(
    RightwayCursorSchema.safeParse({ ...RightwayCursor.initial, page: 1 })
      .success,
  ).toBe(false);
  expect(
    (await run(undefined, { source: "rightway", phase: "complete" }))
      .pagesProcessed,
  ).toBe(0);
  expect(requests).toEqual([]);
});

import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamMidwayInventoryWithRequestGate } from "./midway-connector";
import type { MidwayCursor } from "./midway-cursor";
import type { MidwayRecord } from "./midway-parser";
import type { MidwayCanonicalVehicle } from "./midway-transform";
import type { MidwayYardCode } from "./midway-yard-metadata";
import {
  midwayTestHome,
  midwayTestPage,
  midwayTestRecord,
  midwayTestRow,
} from "./midway-test-fixtures";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const secondRecord = {
  ...midwayTestRecord,
  vin: "3VWD17AJ5FM212524",
  stock: "2604447",
};

function mockInventory(
  options: {
    records?: Partial<Record<MidwayYardCode, readonly MidwayRecord[]>>;
    rewrite?: (body: string, url: URL) => string;
    response?: (body: string, url: URL) => Response;
  } = {},
) {
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.origin).toBe("https://midwayupull.com");
      requests.push(url.href);
      let body = midwayTestHome;
      if (url.pathname !== "/") {
        const code = url.searchParams.get("id");
        if (code !== "MO38" && code !== "MO09")
          throw new Error("Unexpected yard request");
        body = midwayTestPage(
          (
            options.records?.[code] ?? [
              code === "MO38" ? midwayTestRecord : secondRecord,
            ]
          )
            .map(midwayTestRow)
            .join(""),
          code,
        );
      }
      body = options.rewrite?.(body, url) ?? body;
      return (
        options.response?.(body, url) ??
        new Response(body, {
          headers: { "content-type": "text/html; charset=UTF-8" },
        })
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
const run = (
  onBatch = (_batch: MidwayCanonicalVehicle[]) => Effect.void,
  startCursor?: MidwayCursor,
  maxPages = 2,
) =>
  Effect.runPromise(
    streamMidwayInventoryWithRequestGate(
      { onBatch, startCursor, maxPages },
      gate,
    ),
  );

test("Midway emits its first two yards before advancing to Tulsa", async () => {
  const requests = mockInventory();
  const vehicles: MidwayCanonicalVehicle[] = [];
  const result = await run((batch) =>
    Effect.sync(() => {
      vehicles.push(...batch);
    }),
  );
  expect(result).toMatchObject({
    status: "paused",
    count: 2,
    pagesProcessed: 2,
    accounting: {
      recordsProcessed: 2,
      recordsRejected: 0,
      duplicateVehicles: 0,
    },
  });
  expect(vehicles.map((v) => v.stateAbbr)).toEqual(["KS", "MO"]);
  expect(requests).toHaveLength(3);
  expect(vehicles.every((v) => v.color === null && v.imageUrl === null)).toBe(
    true,
  );
});

test("Midway resumes at the next yard without recrawling the accepted first table", async () => {
  mockInventory();
  const first = await run(undefined, undefined, 1);
  expect(first.status).toBe("paused");
  const requests = mockInventory();
  const second = await run(undefined, first.cursor, 1);
  expect(second.status).toBe("paused");
  expect(second.cursor).toMatchObject({ phase: "yard", yardCode: "OO95" });
  expect(second.count).toBe(1);
  expect(requests.map((url) => new URL(url).searchParams.get("id"))).toEqual([
    null,
    "MO09",
  ]);
});

test("Midway rejects a saturated native view before any inventory callback", async () => {
  const requests = mockInventory({
    records: {
      MO38: Array.from({ length: 500 }, (_, index) => ({
        ...midwayTestRecord,
        vin: "1C3CCCAB6GN" + String(125544 + index),
        stock: String(2604445 + index),
      })),
    },
  });
  let callbacks = 0;
  await expect(
    run(() =>
      Effect.sync(() => {
        callbacks++;
      }),
    ),
  ).rejects.toThrow("500-row");
  expect(callbacks).toBe(0);
  expect(requests).toHaveLength(2);
});

test.each(["same-yard", "cross-yard"])(
  "Midway rejects %s duplicate identities",
  async (scope) => {
    mockInventory({
      records:
        scope === "same-yard"
          ? { MO38: [midwayTestRecord, midwayTestRecord] }
          : { MO09: [midwayTestRecord] },
    });
    await expect(run()).rejects.toThrow("Duplicate native stock/VIN");
  },
);

function records() {
  return Array.from({ length: 10 }, (_, index) => ({
    ...midwayTestRecord,
    vin: "1C3CCCAB6GN" + String(125544 + index),
    stock: String(2604445 + index),
  }));
}
test("Midway checks per-yard rejection before callbacks and retains rejected VIN presence", async () => {
  const rows = records().map((r, i) =>
    i === 9 ? { ...r, model: "Unknown" } : r,
  );
  mockInventory({ records: { MO38: rows } });
  const result = await run(undefined, undefined, 1);
  expect(result.count).toBe(9);
  expect(result.observedVins).toEqual(["1C3CCCAB6GN125553"]);
  expect(result.accounting?.recordsRejected).toBe(1);
  mockInventory({
    records: {
      MO38: rows.map((r, i) => (i === 8 ? { ...r, model: "Unknown" } : r)),
    },
  });
  let callbacks = 0;
  await expect(
    run(() =>
      Effect.sync(() => {
        callbacks++;
      }),
    ),
  ).rejects.toThrow("10% rejection limit");
  expect(callbacks).toBe(0);
  mockInventory({
    records: { MO09: [{ ...secondRecord, vin: "1C3CCCAB6GN125553" }] },
  });
  await expect(run(undefined, result.cursor)).rejects.toThrow(
    "Duplicate native stock/VIN",
  );
});

test("Midway allows repeated absent optional stocks without rejecting donors", async () => {
  mockInventory({
    records: {
      MO38: records().map((r) => ({ ...r, stock: "", row: "", arrived: "" })),
    },
  });
  const result = await run(undefined, undefined, 1);
  expect(result.count).toBe(10);
  expect(result.accounting?.recordsRejected).toBe(0);
});

test.each<ResponseInit>([
  { status: 403, headers: { "content-type": "text/html" } },
  { status: 206, headers: { "content-type": "text/html" } },
  { headers: { "content-type": "application/json" } },
  {
    headers: { "content-type": "text/html", "content-range": "bytes 0-10/100" },
  },
  { headers: { "content-type": "text/html", "content-length": "1" } },
])(
  "Midway fails closed at HTTP/body boundaries without retry (%#)",
  async (init) => {
    const requests = mockInventory({
      response: (body) => new Response(body, init),
    });
    await expect(run()).rejects.toThrow("previous inventory is preserved");
    expect(requests).toHaveLength(1);
  },
);

test("Midway blocks changed ownership and body truncation before emitting", async () => {
  for (const rewrite of [
    (body: string) => body.replace("913-287-6185", "913-000-0000"),
    (body: string) => body.replace("</tbody>", ""),
  ]) {
    mockInventory({ rewrite });
    let emitted = 0;
    await expect(
      run(() =>
        Effect.sync(() => {
          emitted++;
        }),
      ),
    ).rejects.toThrow("previous inventory is preserved");
    expect(emitted).toBe(0);
  }
});

test("Midway validates budgets before fetching and makes terminal replay idempotent", async () => {
  const requests = mockInventory();
  await expect(run(undefined, undefined, 0)).rejects.toThrow(
    "validated Midway cursor",
  );
  const result = await run(undefined, { source: "midway", phase: "complete" });
  expect(result.pagesProcessed).toBe(0);
  expect(requests).toEqual([]);
});

test("Midway does not retry a network failure", async () => {
  const requests = mockInventory({
    response: () => {
      throw new TypeError("network unavailable");
    },
  });
  await expect(run()).rejects.toThrow("previous inventory is preserved");
  expect(requests).toHaveLength(1);
});

test("Midway rejects a redirected response before callbacks", async () => {
  mockInventory({
    response: (body) => {
      const response = new Response(body, {
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "url", { value: "https://example.com/" });
      return response;
    },
  });
  await expect(run()).rejects.toThrow("unredirected HTTP 200");
});

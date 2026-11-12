import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamIdipullInventoryWithRequestGate } from "./idipull-connector";
import { IdipullCursor, IdipullCursorSchema } from "./idipull-cursor";
import type { IdipullRecord } from "./idipull-parser";
import type { IdipullCanonicalVehicle } from "./idipull-transform";
import {
  idipullTestHome,
  idipullTestPage,
  idipullTestRecord,
  idipullTestRow,
} from "./idipull-test-fixtures";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect;
function mockInventory(
  options: {
    records?: IdipullRecord[];
    rewrite?: (body: string, path: string) => string;
    response?: (body: string, path: string) => Response;
  } = {},
) {
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.origin).toBe("https://ifipull.com");
      expect(["/", "/inventory/"]).toContain(url.pathname);
      expect(url.search).toBe("");
      requests.push(url.pathname);
      const raw =
        url.pathname === "/"
          ? idipullTestHome
          : idipullTestPage(
              (options.records ?? [idipullTestRecord])
                .map(idipullTestRow)
                .join(""),
            );
      const body = options.rewrite?.(raw, url.pathname) ?? raw;
      return (
        options.response?.(body, url.pathname) ??
        new Response(body, { headers: { "content-type": "text/html" } })
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
const run = (
  onBatch = (_batch: IdipullCanonicalVehicle[]) => Effect.void,
  startCursor?: IdipullCursor,
  maxPages = 1,
) =>
  Effect.runPromise(
    streamIdipullInventoryWithRequestGate(
      { onBatch, startCursor, maxPages },
      gate,
    ),
  );
function records(count: number): IdipullRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    ...idipullTestRecord,
    vin: "1GBJG31K58" + String(1198313 + index),
    stockNumber: "STK" + String(15489 + index).padStart(6, "0"),
  }));
}

test("Idaho Falls validates ownership and complete scope before emitting one batch", async () => {
  const requests = mockInventory();
  const emitted: IdipullCanonicalVehicle[] = [];
  const result = await run((batch) =>
    Effect.sync(() => {
      emitted.push(...batch);
    }),
  );
  expect(requests).toEqual(["/", "/inventory/"]);
  expect(result).toMatchObject({
    status: "complete",
    count: 1,
    pagesProcessed: 1,
    cursor: { source: "idipull", phase: "complete" },
    observedVins: [],
    accounting: {
      recordsProcessed: 1,
      recordsRejected: 0,
      duplicateVehicles: 0,
    },
  });
  expect(emitted[0]?.vin).toBe(idipullTestRecord.vin);
});

test("Idaho Falls rejects every conflicting duplicate row and retains valid presence", async () => {
  const rows = records(20);
  rows[19] = { ...idipullTestRecord, stockNumber: "STK999999", row: "31" };
  mockInventory({ records: rows });
  const emitted: IdipullCanonicalVehicle[] = [];
  const result = await run((batch) =>
    Effect.sync(() => {
      emitted.push(...batch);
    }),
  );
  expect(result.count).toBe(18);
  expect(result.observedVins).toEqual([idipullTestRecord.vin]);
  expect(result.accounting).toMatchObject({
    recordsProcessed: 20,
    recordsRejected: 2,
    duplicateVehicles: 0,
  });
  expect(emitted.some((vehicle) => vehicle.vin === idipullTestRecord.vin)).toBe(
    false,
  );
});

test("Idaho Falls accepts exactly ten percent required rejection and blocks larger loss before callbacks", async () => {
  const rows = records(10).map((record, index) =>
    index === 9 ? { ...record, model: "" } : record,
  );
  mockInventory({ records: rows });
  expect((await run()).observedVins).toEqual([rows[9]?.vin ?? ""]);
  mockInventory({
    records: rows.map((record, index) =>
      index === 8 ? { ...record, model: "" } : record,
    ),
  });
  let callbacks = 0;
  await expect(
    Effect.runPromise(
      streamIdipullInventoryWithRequestGate(
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
  ).rejects.toThrow("10% rejection");
  expect(callbacks).toBe(0);
});

test("Idaho Falls de-duplicates identical rows while enforcing the unchanged duplicate guard", async () => {
  const rows = records(20);
  mockInventory({ records: [...rows, idipullTestRecord] });
  const result = await run();
  expect(result.count).toBe(20);
  expect(result.accounting?.duplicateVehicles).toBe(1);
  mockInventory({
    records: [...rows, ...Array.from({ length: 7 }, () => idipullTestRecord)],
  });
  await expect(run()).rejects.toThrow("25% duplicate");
});

const responseBoundaries: ResponseInit[] = [
  { status: 206, headers: { "content-type": "text/html" } },
  { status: 403, headers: { "content-type": "text/html" } },
  { status: 200, headers: { "content-type": "application/json" } },
  {
    status: 200,
    headers: { "content-type": "text/html", "content-range": "bytes 0-1/100" },
  },
  {
    status: 200,
    headers: { "content-type": "text/html", "content-length": "1" },
  },
];
test.each(responseBoundaries)(
  "Idaho Falls rejects incomplete transports without retries (%#)",
  async (init) => {
    const requests = mockInventory({
      response: (body) => new Response(body, init),
    });
    await expect(run()).rejects.toThrow("previous inventory is preserved");
    expect(requests).toEqual(["/"]);
  },
);

test("Idaho Falls rejects changed destinations, invalid UTF8 and unreadable bodies", async () => {
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
  await expect(run()).rejects.toThrow("verified destination");
  mockInventory({
    response: () =>
      new Response(new Uint8Array([255]), {
        headers: { "content-type": "text/html" },
      }),
  });
  await expect(run()).rejects.toThrow("previous inventory is preserved");
  mockInventory({
    response: () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("Read failed"));
          },
        }),
        { headers: { "content-type": "text/html" } },
      ),
  });
  await expect(run()).rejects.toThrow("Read failed");
});

test.each([
  (html: string, path: string) =>
    path === "/" ? html.replace("in-stock vehicles", "sold vehicles") : html,
  (html: string, path: string) =>
    path === "/inventory/" ? html.replace("</tbody>", "") : html,
  (html: string, path: string) =>
    path === "/inventory/"
      ? html.replace("bInfo: false", "ajax: '/next', bInfo: false")
      : html,
])(
  "Idaho Falls blocks callbacks after ownership or scope drift (%#)",
  async (rewrite) => {
    mockInventory({ rewrite });
    let callbacks = 0;
    await expect(
      run(() =>
        Effect.sync(() => {
          callbacks++;
        }),
      ),
    ).rejects.toThrow("previous inventory is preserved");
    expect(callbacks).toBe(0);
  },
);

test("Idaho Falls propagates callbacks and validates cursors and budgets before requests", async () => {
  mockInventory();
  await expect(
    Effect.runPromise(
      streamIdipullInventoryWithRequestGate(
        { onBatch: () => Effect.fail(new Error("Batch failed")) },
        gate,
      ),
    ),
  ).rejects.toThrow("Batch failed");
  const requests = mockInventory();
  await expect(run(undefined, undefined, 0)).rejects.toThrow("checkpoint");
  expect(
    IdipullCursorSchema.safeParse({ ...IdipullCursor.initial, page: 1 })
      .success,
  ).toBe(false);
  expect(
    (await run(undefined, { source: "idipull", phase: "complete" }))
      .pagesProcessed,
  ).toBe(0);
  expect(requests).toEqual([]);
});

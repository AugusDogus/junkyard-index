import { afterEach, expect, test } from "bun:test";
import { Effect, Either } from "effect";
import {
  streamMidwayInventory,
  streamMidwayInventoryWithRequestGate,
} from "./midway-connector";
import type { MidwayCursor } from "./midway-cursor";
import type { MidwayRecord } from "./midway-parser";
import type { MidwayCanonicalVehicle } from "./midway-transform";
import type { MidwayYardCode } from "./midway-yard-metadata";
import {
  midwayTestEmptyPage,
  midwayTestHome,
  midwayTestPage,
  midwayTestRecord,
  midwayTestRow,
} from "./midway-test-fixtures";
import { runWithQueuedHost } from "./provider-host-test-support";

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

const muncieFord = {
  ...midwayTestRecord,
  make: "FORD",
  model: "F-150",
  vin: "1FTFW1ET5DFC10312",
  stock: "2604501",
};
const libertyFord = {
  ...muncieFord,
  vin: "1FTFW1ET5DFC10313",
  stock: "2604502",
};
const defaultRecords = {
  MO38: [midwayTestRecord, muncieFord],
  MO09: [secondRecord, libertyFord],
  OO95: [],
} satisfies Record<MidwayYardCode, readonly MidwayRecord[]>;
const yardCodes = ["MO38", "MO09", "OO95"] as const;
/** The menu lists every native make; JEEP is an explicitly empty control. */
const menu = (records: readonly MidwayRecord[]) => [
  ...new Set([...records.map((record) => record.make), "JEEP"]),
];

/**
 * Serves each yard's broad view (its records, a capped witness) and one page
 * per make control (that make's records, or `makePages` when given).
 */
function mockInventory(
  options: {
    records?: Partial<Record<MidwayYardCode, readonly MidwayRecord[]>>;
    makePages?: Partial<
      Record<MidwayYardCode, Record<string, readonly MidwayRecord[]>>
    >;
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
        const code = yardCodes.find((c) => c === url.searchParams.get("id"));
        const path = /^\/inventory\/([^/]+)\/ANY\/$/.exec(url.pathname)?.[1];
        if (code === undefined || path === undefined)
          throw new Error("Unexpected yard request");
        const records = options.records?.[code] ?? defaultRecords[code];
        const make = decodeURIComponent(path)
          .replace("_", " ")
          .replace(".", "/");
        const rows =
          make === "ANY"
            ? records
            : (options.makePages?.[code]?.[make] ??
              records.filter((record) => record.make === make));
        body =
          make === "ANY"
            ? midwayTestPage(rows.map(midwayTestRow).join(""), code, {
                makes: menu(records),
              })
            : rows.length
              ? midwayTestPage(rows.map(midwayTestRow).join(""), code, { make })
              : midwayTestEmptyPage(code, make);
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
/** Yard and make of each request; the home page is "home". */
const requested = (requests: readonly string[]) =>
  requests.map((href) => {
    const url = new URL(href);
    return url.pathname === "/"
      ? "home"
      : `${url.searchParams.get("id")} ${url.pathname.split("/")[2]}`;
  });
/** One yard's full traversal of the default menu: opening, makes, closing. */
const traversal = (code: MidwayYardCode) => [
  code + " ANY",
  code + " CHRYSLER",
  code + " FORD",
  code + " JEEP",
  code + " ANY",
];
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

test("Midway emits its first two yards by make traversal before advancing to Tulsa", async () => {
  const requests = mockInventory();
  const vehicles: MidwayCanonicalVehicle[] = [];
  const result = await run((batch) =>
    Effect.sync(() => {
      vehicles.push(...batch);
    }),
  );
  expect(result).toMatchObject({
    status: "paused",
    cursor: { phase: "opening", yardCode: "OO95" },
    count: 4,
    pagesProcessed: 2,
    accounting: {
      recordsProcessed: 4,
      recordsRejected: 0,
      duplicateVehicles: 0,
    },
  });
  expect(vehicles.map((v) => v.stateAbbr)).toEqual(["KS", "KS", "MO", "MO"]);
  expect(requested(requests)).toEqual([
    "home",
    ...traversal("MO38"),
    ...traversal("MO09"),
  ]);
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
  expect(second.cursor).toMatchObject({ phase: "opening", yardCode: "OO95" });
  expect(second.count).toBe(2);
  expect(requested(requests)).toEqual(["home", ...traversal("MO09")]);
});

test("Midway rejects a saturated native make page before any inventory callback", async () => {
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
  expect(requested(requests)).toEqual(["home", "MO38 ANY", "MO38 CHRYSLER"]);
});

test("Midway refuses a make page as large as the capped broad view before any callback", async () => {
  // A broad view that stopped at 2 rows proves the cap can be 2, so a 2-row
  // make page may be capped the same way.
  const requests = mockInventory({
    makePages: {
      MO38: { CHRYSLER: [midwayTestRecord, secondRecord] },
    },
  });
  let callbacks = 0;
  const count = () =>
    Effect.sync(() => {
      callbacks++;
    });
  await expect(
    Effect.runPromise(
      streamMidwayInventoryWithRequestGate(
        { onBatch: count, onYards: count },
        gate,
      ),
    ),
  ).rejects.toThrow("may be truncated");
  expect(callbacks).toBe(0);
  expect(requested(requests)).toEqual(["home", "MO38 ANY", "MO38 CHRYSLER"]);
});

test.each(["same-yard", "cross-yard"])(
  "Midway rejects %s duplicate identities",
  async (scope) => {
    mockInventory({
      records:
        scope === "same-yard"
          ? { MO38: [midwayTestRecord, midwayTestRecord, muncieFord] }
          : { MO09: [midwayTestRecord, libertyFord] },
    });
    await expect(run()).rejects.toThrow("Duplicate native stock/VIN");
  },
);

function records() {
  return Array.from({ length: 10 }, (_, index) => ({
    ...midwayTestRecord,
    ...(index % 2 ? { make: "FORD", model: "F-150" } : {}),
    vin: "1C3CCCAB6GN" + String(125544 + index),
    stock: String(2604445 + index),
  }));
}
test("Midway checks per-yard rejection before publishing the yard and retains rejected VIN presence", async () => {
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
  // Make pages stage donors as they are read; the yard-wide guard runs at
  // the closing witness, before the yard is published.
  let yards = 0;
  await expect(
    Effect.runPromise(
      streamMidwayInventoryWithRequestGate(
        {
          onBatch: () => Effect.void,
          onYards: () =>
            Effect.sync(() => {
              yards++;
            }),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("10% rejection limit");
  expect(yards).toBe(0);
  mockInventory({
    records: {
      MO09: [{ ...secondRecord, vin: "1C3CCCAB6GN125553" }, libertyFord],
    },
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

test("Midway keeps advancing through a yard traversal when every shared host turn waits minutes", async () => {
  // About 20 URG sources share one lease at 07:00, so each turn waits about
  // 2.5 minutes. The old five-minute wall deadline counted that queue time,
  // and the ownership page took a turn of its own before every request.
  const requests = mockInventory();
  const vehicles: MidwayCanonicalVehicle[] = [];
  const chunk = (startCursor: MidwayCursor | undefined) =>
    runWithQueuedHost(
      streamMidwayInventory({
        startCursor,
        maxPages: 2,
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles.push(...batch);
          }),
      }),
      { turnWaitMs: 150_000 },
    );
  const first = await chunk(undefined);
  if (Either.isLeft(first.result)) throw first.result.left;
  // The ownership page and the Muncie opening witness share one turn, and
  // the chunk advances to the make traversal.
  expect(first.result.right.pagesProcessed).toBe(0);
  expect(first.result.right.cursor).toMatchObject({
    phase: "census",
    yardCode: "MO38",
    makes: ["CHRYSLER", "FORD", "JEEP"],
  });
  expect(first.elapsedMs).toBeLessThanOrEqual(6 * 60_000);
  expect(first.turns).toHaveLength(1);
  expect(first.turns.every((turn) => turn.releasedAt !== null)).toBe(true);
  expect(vehicles).toEqual([]);
  expect(requested(requests)).toEqual(["home", "MO38 ANY"]);

  // A resumed chunk re-checks ownership in the same turn as its next make.
  requests.length = 0;
  const second = await chunk(first.result.right.cursor);
  if (Either.isLeft(second.result)) throw second.result.left;
  expect(second.result.right.pagesProcessed).toBe(0);
  expect(second.result.right.cursor).toMatchObject({
    phase: "census",
    yardCode: "MO38",
    makes: ["FORD", "JEEP"],
  });
  expect(second.elapsedMs).toBeLessThanOrEqual(6 * 60_000);
  expect(second.turns).toHaveLength(1);
  expect(vehicles.map((v) => v.stateAbbr)).toEqual(["KS"]);
  expect(requested(requests)).toEqual(["home", "MO38 CHRYSLER"]);
}, 120_000);

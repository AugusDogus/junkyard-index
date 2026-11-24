import { afterEach, expect, test } from "bun:test";
import { Effect, Either } from "effect";
import { soakLittletonInventory } from "../../../scripts/soak-littleton";
import { streamLittletonInventoryWithRequestGate } from "./littleton-connector";
import { LittletonCursor, LittletonCursorSchema } from "./littleton-cursor";
import { littletonPairKey, type LittletonRecord } from "./littleton-parser";
import {
  littletonTestAnalytics,
  littletonTestConfig,
  littletonTestInventory,
  littletonTestOwner,
  littletonTestRecord,
  littletonTestSearch,
} from "./littleton-test-fixtures";
import type { LittletonCanonicalVehicle } from "./littleton-transform";
import { validationRejectionKind } from "./ingestion-validation";
import { runWithQueuedHost } from "./provider-host-test-support";
import {
  LITTLETON_ANALYTICS_URL,
  LITTLETON_CONFIG_URL,
  LITTLETON_INVENTORY_URL,
  LITTLETON_ORIGIN,
  LITTLETON_SEARCH_URL,
} from "./littleton-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const second = {
  ...littletonTestRecord,
  stock: "STK056375",
  vin: "2HNYD18845H540310",
  model: "TL",
};
type Kind = "owner" | "inventory" | "config" | "analytics" | "search";
function mock(
  options: {
    records?: readonly LittletonRecord[];
    searches?: Map<string, readonly LittletonRecord[]>;
    rewrite?: (body: string, kind: Kind, ordinal: number) => string;
    response?: (body: string, kind: Kind) => Response;
  } = {},
) {
  const records = options.records ?? [littletonTestRecord, second];
  const requests: Kind[] = [];
  let contexts = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("User-Agent")).toBe(
        "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0",
      );
      const url = input instanceof Request ? input.url : String(input);
      let kind: Kind;
      let body: string;
      if (url === LITTLETON_ORIGIN + "/") {
        kind = "owner";
        contexts++;
        body = littletonTestOwner;
      } else if (url === LITTLETON_INVENTORY_URL) {
        kind = "inventory";
        body = littletonTestInventory(records);
      } else if (url === LITTLETON_CONFIG_URL) {
        kind = "config";
        body = littletonTestConfig;
      } else if (url === LITTLETON_ANALYTICS_URL) {
        kind = "analytics";
        body = littletonTestAnalytics(records);
      } else if (url === LITTLETON_SEARCH_URL) {
        kind = "search";
        expect(init?.method).toBe("POST");
        const query: unknown = JSON.parse(
          typeof init?.body === "string" ? init.body : "",
        );
        if (
          typeof query !== "object" ||
          query === null ||
          !("make" in query) ||
          !("model" in query) ||
          typeof query.make !== "string" ||
          typeof query.model !== "string"
        )
          throw new Error("Unexpected query");
        const pair = { make: query.make, model: query.model };
        const expectedQuery = {
          ...pair,
          yard_id: "littleton_u_pull_it",
          year_min: null,
          year_max: null,
          language: "en",
          location_id: null,
        };
        expect(query).toEqual(expectedQuery);
        body = littletonTestSearch(
          options.searches?.get(littletonPairKey(pair)) ??
            records.filter(
              (r) => r.make === pair.make && r.model === pair.model,
            ),
          pair,
        );
      } else throw new Error("Unsaved Littleton request " + url);
      requests.push(kind);
      body = options.rewrite?.(body, kind, contexts) ?? body;
      return (
        options.response?.(body, kind) ??
        new Response(body, {
          headers: {
            "content-type":
              kind === "owner" || kind === "inventory"
                ? "text/html"
                : "application/json",
          },
        })
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
const run = (
  cursor: LittletonCursor = LittletonCursor.initial,
  maxPages = 16,
  onBatch: (
    batch: LittletonCanonicalVehicle[],
  ) => Effect.Effect<void, Error> = () => Effect.void,
) =>
  Effect.runPromise(
    streamLittletonInventoryWithRequestGate(
      { startCursor: cursor, maxPages, onBatch },
      gate,
    ),
  );

test("Littleton resumes serialized cumulative coverage and excludes agreeing cross-query hits", async () => {
  const requests = mock({
    searches: new Map([
      [littletonPairKey(second), [littletonTestRecord, second]],
    ]),
  });
  const vehicles: LittletonCanonicalVehicle[] = [];
  const callback = (batch: LittletonCanonicalVehicle[]) =>
    Effect.sync(() => {
      vehicles.push(...batch);
    });
  const first = await run(undefined, 1, callback);
  expect(first.status).toBe("paused");
  expect(first.cursor.phase).toBe("queries");
  const cursor = LittletonCursorSchema.parse(
    JSON.parse(JSON.stringify(first.cursor)),
  );
  const last = await run(cursor, 1, callback);
  expect(last).toMatchObject({
    status: "complete",
    count: 1,
    pagesProcessed: 1,
    accounting: {
      recordsProcessed: 2,
      recordsExcluded: 1,
      recordsRejected: 0,
      duplicateVehicles: 0,
    },
  });
  expect(vehicles.map((r) => r.vin)).toEqual([
    littletonTestRecord.vin,
    second.vin,
  ]);
  expect(requests.filter((r) => r === "search")).toHaveLength(2);
  expect(requests.filter((r) => r === "owner")).toHaveLength(3);
  const count = requests.length;
  expect((await run(last.cursor)).pagesProcessed).toBe(0);
  expect(requests).toHaveLength(count);
});

test.each([0, 33, 1.5, Number.NaN])(
  "Littleton rejects invalid query budget %s before requests",
  async (budget) => {
    const requests = mock();
    await expect(run(undefined, budget)).rejects.toThrow("query budget");
    expect(requests).toEqual([]);
  },
);
test("Littleton callbacks fail without mutating the caller checkpoint", async () => {
  mock();
  const first = await run(undefined, 1);
  const saved = JSON.stringify(first.cursor);
  await expect(
    run(first.cursor, 1, () => Effect.fail(new Error("staging failed"))),
  ).rejects.toThrow("staging failed");
  expect(JSON.stringify(first.cursor)).toBe(saved);
});
test.each([
  [
    "missing own-query stock",
    new Map([[littletonPairKey(second), [littletonTestRecord]]]),
  ],
  [
    "conflicting repeated record",
    new Map([
      [
        littletonPairKey(second),
        [{ ...littletonTestRecord, color: "WHITE" }, second],
      ],
    ]),
  ],
  [
    "foreign stock",
    new Map([[littletonPairKey(second), [{ ...second, stock: "STK999999" }]]]),
  ],
  [
    "conflicting source year",
    new Map([[littletonPairKey(second), [{ ...second, year: 2006 }]]]),
  ],
  [
    "duplicate valid VIN",
    new Map([
      [littletonPairKey(second), [{ ...second, vin: littletonTestRecord.vin }]],
    ]),
  ],
  [
    "position conflict",
    new Map([[littletonPairKey(second), [{ ...second, vehicleRow: "99" }]]]),
  ],
  [
    "arrival conflict",
    new Map([
      [
        littletonPairKey(second),
        [{ ...second, dateAdded: "2026-11-05T12:00:00" }],
      ],
    ]),
  ],
] as const)(
  "Littleton blocks %s before chunk callbacks",
  async (_label, searches) => {
    mock({ searches });
    let callbacks = 0;
    await expect(
      run(undefined, 16, () =>
        Effect.sync(() => {
          callbacks++;
        }),
      ),
    ).rejects.toThrow("prior inventory is preserved");
    expect(callbacks).toBe(0);
  },
);
test("Littleton checks opening and closing context and durable counters", async () => {
  mock();
  const first = await run(undefined, 1);
  if (first.cursor.phase !== "queries")
    throw new Error("Expected query checkpoint");
  expect(
    LittletonCursorSchema.safeParse({
      ...first.cursor,
      nextQuery: first.cursor.nextQuery + 1,
    }).success,
  ).toBe(false);
  expect(
    LittletonCursorSchema.safeParse({ ...first.cursor, seen: [] }).success,
  ).toBe(false);
  mock({
    rewrite: (body, kind) =>
      kind === "inventory" ? body.replace("<td>35</td>", "<td>36</td>") : body,
  });
  await expect(run(first.cursor)).rejects.toThrow("changed during the crawl");
  mock({
    rewrite: (body, kind, ordinal) =>
      kind === "config" && ordinal === 2
        ? body.replace('"photos_enabled":false', '"photos_enabled":true')
        : body,
  });
  let callbacks = 0;
  await expect(
    run(undefined, 16, () =>
      Effect.sync(() => {
        callbacks++;
      }),
    ),
  ).rejects.toThrow("prior inventory is preserved");
  expect(callbacks).toBe(0);
});

test("Littleton marks a yard publishing mid-crawl as transient drift so the source retries the same day", async () => {
  const rejection = (cursor?: LittletonCursor, maxPages?: number) =>
    run(cursor, maxPages).then(
      () => {
        throw new Error("Expected a Littleton rejection");
      },
      (error: unknown) => error,
    );
  // The website table and the VinPlus counts publish separately, so one
  // context read can see the new table with the old counts.
  mock({
    rewrite: (body, kind) =>
      kind === "analytics"
        ? littletonTestAnalytics([littletonTestRecord])
        : body,
  });
  const unreconciled = await rejection();
  expect(String(unreconciled)).toContain(
    "Official stock/year table (2 stocks) does not reconcile with native active inventory counts (1 stock); year 2005: table 2, counts 1",
  );
  expect(validationRejectionKind(unreconciled)).toBe("transient");

  mock();
  const first = await run(undefined, 1);
  if (first.cursor.phase !== "queries")
    throw new Error("Expected query checkpoint");
  mock({
    rewrite: (body, kind) =>
      kind === "inventory" ? body.replace("<td>35</td>", "<td>36</td>") : body,
  });
  const resumed = await rejection(first.cursor);
  expect(String(resumed)).toContain("changed during the crawl");
  expect(validationRejectionKind(resumed)).toBe("transient");

  // A vehicle moved rows between the opening and closing context reads.
  mock({
    rewrite: (body, kind, ordinal) =>
      kind === "inventory" && ordinal === 2
        ? body.replace("<td>35</td>", "<td>36</td>")
        : body,
  });
  const closing = await rejection();
  expect(String(closing)).toContain("changed during the crawl");
  expect(validationRejectionKind(closing)).toBe("transient");
  // A drift retry is automatic, so the wrapper does not also ask a reader
  // to inspect the native source.
  for (const error of [unreconciled, resumed, closing])
    expect(String(error)).not.toContain("Inspect the native source");
});

test("Littleton rejects corrupted prior VINs, native fingerprints and receipt hashes before requests", async () => {
  mock();
  const first = await run(undefined, 1);
  if (first.cursor.phase !== "queries")
    throw new Error("Expected query checkpoint");
  const cursor = first.cursor;
  const corrupted = {
    ...cursor,
    seen: cursor.seen.map((entry, index) =>
      index === 0
        ? { ...entry, vin: "11111111111111111", hash: "f".repeat(64) }
        : entry,
    ),
    receipts: cursor.receipts.map((receipt, index) =>
      index === 0 ? { ...receipt, hash: "e".repeat(64) } : receipt,
    ),
  };
  expect(LittletonCursorSchema.safeParse(corrupted).success).toBe(false);
  const requests = mock();
  await expect(run(corrupted)).rejects.toThrow("validated Littleton cursor");
  expect(requests).toEqual([]);
});
test("Littleton applies the 10% rejection cap cumulatively and retains valid rejected VINs", async () => {
  const records = Array.from({ length: 10 }, (_, i) => ({
    ...littletonTestRecord,
    stock: "STK" + String(60000 + i).padStart(6, "0"),
    vin: "2HNYD18845H" + String(540300 + i),
  }));
  const native = records.map((r, i) =>
    i === 9 ? { ...r, model: "Unknown" } : r,
  );
  mock({
    records,
    searches: new Map([[littletonPairKey(littletonTestRecord), native]]),
  });
  const result = await run();
  expect(result.count).toBe(9);
  const rejected = records[9];
  if (!rejected) throw new Error("Missing expected rejected fixture");
  expect(result.observedVins).toEqual([rejected.vin]);
  expect(result.accounting?.recordsRejected).toBe(1);
  mock({
    records,
    searches: new Map([
      [
        littletonPairKey(littletonTestRecord),
        native.map((r, i) => (i === 8 ? { ...r, vin: "INVALID" } : r)),
      ],
    ]),
  });
  await expect(run()).rejects.toThrow("10% rejection limit");
});
const responseBoundaries: ResponseInit[] = [
  { status: 206, headers: { "content-type": "text/html" } },
  {
    status: 200,
    headers: { "content-type": "text/html", "content-range": "bytes 0-5/500" },
  },
  { status: 200, headers: { "content-type": "application/json" } },
  {
    status: 200,
    headers: { "content-type": "text/html", "content-length": "1" },
  },
  { status: 429, headers: { "content-type": "text/html" } },
];
test.each(responseBoundaries)(
  "Littleton rejects incomplete or wrong HTTP boundaries (%#) without retry",
  async (init) => {
    const requests = mock({ response: (body) => new Response(body, init) });
    await expect(run()).rejects.toThrow("prior inventory is preserved");
    expect(requests).toEqual(["owner"]);
  },
);
test("Littleton rejects foreign response destinations", async () => {
  mock({
    response: (body) => {
      const response = new Response(body, {
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "url", { value: "https://example.com/" });
      return response;
    },
  });
  await expect(run()).rejects.toThrow("verified endpoint");
});

test("Littleton soak aggregates complete coverage and preserves a bounded partial checkpoint", async () => {
  mock();
  const complete = await soakLittletonInventory((cursor, budget) =>
    run(cursor, budget),
  );
  expect(complete).toMatchObject({
    status: "complete",
    count: 2,
    pagesProcessed: 2,
    cursor: { source: "littleton", phase: "complete" },
    accounting: {
      recordsProcessed: 2,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    },
  });
  mock();
  const partial = await soakLittletonInventory(
    (cursor, budget) => run(cursor, budget),
    1,
  );
  expect(partial).toMatchObject({
    status: "paused",
    count: 1,
    pagesProcessed: 1,
    cursor: { source: "littleton", phase: "queries", nextQuery: 1 },
  });
});

test("Littleton soak rejects stalled chunks and invalid total query budgets", async () => {
  mock();
  await expect(
    soakLittletonInventory((cursor, budget) => run(cursor, budget), 0),
  ).rejects.toThrow("query budget");
  await expect(
    soakLittletonInventory(async (cursor) => ({
      source: "littleton",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 0,
      errors: [],
    })),
  ).rejects.toThrow("no query progress");
});

test("Littleton completes a crawl when every VinPlus turn waits minutes", async () => {
  // About 20 sources share the VinPlus lease at 07:00, so each turn waits
  // about 2.5 minutes. A resumed terminal chunk used to need five turns
  // (config, analytics, last search, closing config, closing analytics) and
  // hit the wall limit.
  const records = Array.from({ length: 6 }, (_, i) => ({
    ...littletonTestRecord,
    stock: "STK" + String(60000 + i).padStart(6, "0"),
    vin: "2HNYD18845H" + String(540300 + i),
    model: "MODEL " + String.fromCharCode(65 + i),
  }));
  const requests = mock({ records });
  let cursor: LittletonCursor = LittletonCursor.initial;
  let vehicles: LittletonCanonicalVehicle[] = [];
  const chunks: { status: string; elapsedMs: number }[] = [];
  while (cursor.phase !== "complete" && chunks.length < 8) {
    const chunk = await runWithQueuedHost(
      streamLittletonInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages: 16,
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles = [...vehicles, ...batch];
            }),
        },
        gate,
      ),
      { turnWaitMs: 150_000 },
    );
    if (Either.isLeft(chunk.result)) throw chunk.result.left;
    chunks.push({
      status: chunk.result.right.status,
      elapsedMs: chunk.elapsedMs,
    });
    expect(chunk.turns.every((turn) => turn.releasedAt !== null)).toBe(true);
    cursor = LittletonCursorSchema.parse(
      JSON.parse(JSON.stringify(chunk.result.right.cursor)),
    );
  }
  expect(cursor.phase).toBe("complete");
  expect(vehicles).toHaveLength(6);
  // Every chunk returns well inside an 800 s function started inline late.
  expect(chunks.every((chunk) => chunk.elapsedMs <= 6 * 60_000)).toBe(true);
  // The closing context still follows the last search.
  expect(requests.slice(-5)).toEqual([
    "search",
    "owner",
    "inventory",
    "config",
    "analytics",
  ]);
}, 120_000);

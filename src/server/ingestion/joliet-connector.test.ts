import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { z } from "zod";
import { soakJolietInventory } from "../../../scripts/soak-joliet";
import { streamJolietInventoryWithRequestGate } from "./joliet-connector";
import { JolietCursor, JolietCursorSchema } from "./joliet-cursor";
import { jolietPairKey, type JolietRecord } from "./joliet-parser";
import {
  jolietTestAnalytics,
  jolietTestConfig,
  jolietTestContact,
  jolietTestInventory,
  jolietTestOwner,
  jolietTestRecord,
  jolietTestSearch,
} from "./joliet-test-fixtures";
import type { JolietCanonicalVehicle } from "./joliet-transform";
import {
  JOLIET_ANALYTICS_URL,
  JOLIET_CONFIG_URL,
  JOLIET_CONTACT_URL,
  JOLIET_INVENTORY_URL,
  JOLIET_ORIGIN,
  JOLIET_SEARCH_URL,
} from "./joliet-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const second = {
  ...jolietTestRecord,
  stock: "STK075103",
  vin: "1FAHP2J89EG117595",
  model: "TRANSIT",
};
type Kind =
  | "owner"
  | "contact"
  | "inventory"
  | "config"
  | "analytics"
  | "search";
const querySchema = z
  .object({
    yard_id: z.literal("joliet_u_pull_it"),
    year_min: z.null(),
    year_max: z.null(),
    make: z.string().min(1),
    model: z.string().min(1),
    language: z.literal("en"),
    location_id: z.null(),
  })
  .strict();
function mock(
  options: {
    records?: readonly JolietRecord[];
    searches?: Map<string, readonly JolietRecord[]>;
    rewrite?: (body: string, kind: Kind, ordinal: number) => string;
    response?: (body: string, kind: Kind) => Response;
  } = {},
) {
  const records = options.records ?? [jolietTestRecord, second];
  const requests: Kind[] = [];
  let contexts = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      let kind: Kind;
      let body: string;
      if (url === JOLIET_ORIGIN + "/") {
        kind = "owner";
        contexts++;
        body = jolietTestOwner;
      } else if (url === JOLIET_CONTACT_URL) {
        kind = "contact";
        body = jolietTestContact;
      } else if (url === JOLIET_INVENTORY_URL) {
        kind = "inventory";
        body = jolietTestInventory(records);
      } else if (url === JOLIET_CONFIG_URL) {
        kind = "config";
        body = jolietTestConfig;
      } else if (url === JOLIET_ANALYTICS_URL) {
        kind = "analytics";
        body = jolietTestAnalytics(records);
      } else if (url === JOLIET_SEARCH_URL) {
        kind = "search";
        expect(init?.method).toBe("POST");
        const query = querySchema.parse(
          JSON.parse(typeof init?.body === "string" ? init.body : ""),
        );
        const pair = { make: query.make, model: query.model };
        body = jolietTestSearch(
          options.searches?.get(jolietPairKey(pair)) ??
            records.filter(
              (record) =>
                record.make === pair.make && record.model === pair.model,
            ),
          pair,
        );
      } else throw new Error("Unsaved Joliet request " + url);
      requests.push(kind);
      body = options.rewrite?.(body, kind, contexts) ?? body;
      return (
        options.response?.(body, kind) ??
        new Response(body, {
          headers: {
            "content-type": ["owner", "contact", "inventory"].includes(kind)
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
  cursor: JolietCursor = JolietCursor.initial,
  maxPages = 16,
  onBatch: (
    batch: JolietCanonicalVehicle[],
  ) => Effect.Effect<void, Error> = () => Effect.void,
) =>
  Effect.runPromise(
    streamJolietInventoryWithRequestGate(
      { startCursor: cursor, maxPages, onBatch },
      gate,
    ),
  );

test("Joliet resumes serialized own-pair coverage and excludes only agreeing cross-query hits", async () => {
  const requests = mock({
    searches: new Map([
      [
        jolietPairKey(second),
        [{ ...jolietTestRecord, daysInYard: 999 }, second],
      ],
    ]),
  });
  const vehicles: JolietCanonicalVehicle[] = [];
  const callback = (batch: JolietCanonicalVehicle[]) =>
    Effect.sync(() => {
      vehicles.push(...batch);
    });
  const first = await run(undefined, 1, callback);
  expect(first.status).toBe("paused");
  const cursor = JolietCursorSchema.parse(
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
  expect(vehicles.map((vehicle) => vehicle.vin)).toEqual([
    jolietTestRecord.vin,
    second.vin,
  ]);
  expect(requests.filter((kind) => kind === "search")).toHaveLength(2);
  expect(requests.filter((kind) => kind === "contact")).toHaveLength(3);
  const count = requests.length;
  expect((await run(last.cursor)).pagesProcessed).toBe(0);
  expect(requests).toHaveLength(count);
});

test.each([0, 33, 1.5, Number.NaN])(
  "Joliet validates query budget before requests (%#)",
  async (budget) => {
    const requests = mock();
    await expect(run(undefined, budget)).rejects.toThrow("query budget");
    expect(requests).toEqual([]);
  },
);
test.each([
  [
    "missing own-query stock",
    new Map([[jolietPairKey(second), [jolietTestRecord]]]),
  ],
  [
    "conflicting stable native record",
    new Map([
      [
        jolietPairKey(second),
        [{ ...jolietTestRecord, engine: "CHANGED" }, second],
      ],
    ]),
  ],
  [
    "foreign stock",
    new Map([[jolietPairKey(second), [{ ...second, stock: "STK999999" }]]]),
  ],
  [
    "source year conflict",
    new Map([[jolietPairKey(second), [{ ...second, year: 2015 }]]]),
  ],
  [
    "duplicate valid VIN",
    new Map([
      [jolietPairKey(second), [{ ...second, vin: jolietTestRecord.vin }]],
    ]),
  ],
  [
    "position conflict",
    new Map([[jolietPairKey(second), [{ ...second, vehicleRow: "77" }]]]),
  ],
  [
    "calendar-date conflict",
    new Map([
      [
        jolietPairKey(second),
        [{ ...second, dateAdded: "2026-08-20T12:00:00" }],
      ],
    ]),
  ],
] as const)(
  "Joliet blocks %s before chunk callbacks",
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

test("Joliet preserves native API YMM when table representations differ", async () => {
  mock({
    searches: new Map([
      [
        jolietPairKey(jolietTestRecord),
        [{ ...jolietTestRecord, make: "TOYOTA", model: "SOURCE MODEL" }],
      ],
    ]),
  });
  const vehicles: JolietCanonicalVehicle[] = [];
  await run(undefined, 16, (batch) =>
    Effect.sync(() => {
      vehicles.push(...batch);
    }),
  );
  expect(
    vehicles.find((vehicle) => vehicle.vin === jolietTestRecord.vin),
  ).toMatchObject({ make: "Toyota", model: "SOURCE MODEL" });
});

test("Joliet rejects corrupted prior fingerprints and receipts before HTTP", async () => {
  mock();
  const first = await run(undefined, 1);
  if (first.cursor.phase !== "queries")
    throw new Error("Expected query checkpoint");
  const cursor = first.cursor;
  const variants = [
    { ...cursor, nextQuery: cursor.nextQuery + 1 },
    { ...cursor, contextHash: "f".repeat(64) },
    { ...cursor, seen: [] },
    {
      ...cursor,
      seen: cursor.seen.map((entry) => ({
        ...entry,
        vin: "11111111111111111",
        hash: "f".repeat(64),
      })),
    },
    {
      ...cursor,
      receipts: cursor.receipts.map((entry) => ({
        ...entry,
        hash: "e".repeat(64),
      })),
    },
  ];
  for (const corrupted of variants) {
    expect(JolietCursorSchema.safeParse(corrupted).success).toBe(false);
    const requests = mock();
    await expect(run(corrupted)).rejects.toThrow("validated Joliet cursor");
    expect(requests).toEqual([]);
  }
});

test("Joliet rejects owner/scope drift on resume and at terminal closing", async () => {
  mock();
  const first = await run(undefined, 1);
  mock({
    rewrite: (body, kind) =>
      kind === "inventory" ? body.replace("<td>99</td>", "<td>98</td>") : body,
  });
  await expect(run(first.cursor)).rejects.toThrow("changed during the crawl");
  mock({
    rewrite: (body, kind, ordinal) =>
      kind === "contact" && ordinal === 2
        ? body.replace("Joliet, IL 60433", "Littleton, CO 80125")
        : body,
  });
  let callbacks = 0;
  await expect(
    run(undefined, 16, () =>
      Effect.sync(() => {
        callbacks++;
      }),
    ),
  ).rejects.toThrow("physical contact ownership");
  expect(callbacks).toBe(0);
});

test("Joliet failing callbacks cannot advance the caller checkpoint", async () => {
  mock();
  const first = await run(undefined, 1);
  const saved = JSON.stringify(first.cursor);
  await expect(
    run(first.cursor, 1, () => Effect.fail(new Error("staging failed"))),
  ).rejects.toThrow("staging failed");
  expect(JSON.stringify(first.cursor)).toBe(saved);
});

test("Joliet cumulative 10% cap retains valid metadata-reject presence", async () => {
  const records = Array.from({ length: 10 }, (_, index) => ({
    ...jolietTestRecord,
    stock: "STK" + String(75000 + index).padStart(6, "0"),
    vin: "1FAHP2J89EG" + String(117500 + index),
  }));
  const native = records.map((record, index) =>
    index === 9 ? { ...record, model: "Unknown" } : record,
  );
  mock({
    records,
    searches: new Map([[jolietPairKey(jolietTestRecord), native]]),
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
        jolietPairKey(jolietTestRecord),
        native.map((record, index) =>
          index === 8 ? { ...record, vin: "INVALID" } : record,
        ),
      ],
    ]),
  });
  await expect(run()).rejects.toThrow("10% rejection limit");
});

test.each<ResponseInit>([
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
])(
  "Joliet rejects incomplete HTTP boundaries without retry (%#)",
  async (init) => {
    const requests = mock({ response: (body) => new Response(body, init) });
    await expect(run()).rejects.toThrow("prior inventory is preserved");
    expect(requests).toEqual(["owner"]);
  },
);
test("Joliet rejects foreign response destinations without retry", async () => {
  const requests = mock({
    response: (body) => {
      const response = new Response(body, {
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "url", { value: "https://example.com/" });
      return response;
    },
  });
  await expect(run()).rejects.toThrow("verified endpoint");
  expect(requests).toEqual(["owner"]);
});

test("Joliet soak reaches terminal coverage or returns an honest bounded checkpoint", async () => {
  mock();
  expect(
    await soakJolietInventory((cursor, budget) => run(cursor, budget)),
  ).toMatchObject({
    status: "complete",
    count: 2,
    pagesProcessed: 2,
    cursor: { source: "joliet", phase: "complete" },
    accounting: {
      recordsProcessed: 2,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    },
  });
  mock();
  expect(
    await soakJolietInventory((cursor, budget) => run(cursor, budget), 1),
  ).toMatchObject({
    status: "paused",
    count: 1,
    pagesProcessed: 1,
    cursor: { source: "joliet", phase: "queries", nextQuery: 1 },
  });
  await expect(
    soakJolietInventory((cursor, budget) => run(cursor, budget), 0),
  ).rejects.toThrow("query budget");
  await expect(
    soakJolietInventory(async (cursor) => ({
      source: "joliet",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 0,
      errors: [],
    })),
  ).rejects.toThrow("no query progress");
});

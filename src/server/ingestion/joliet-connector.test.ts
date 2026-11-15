import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { z } from "zod";
import { soakJolietInventory } from "../../../scripts/soak-joliet";
import { fetchJolietContext } from "./joliet-client";
import { streamJolietInventoryWithRequestGate } from "./joliet-connector";
import { JolietCursor, JolietCursorSchema } from "./joliet-cursor";
import {
  jolietPairKey,
  parseJolietInventory,
  parseJolietSearch,
  parseJolietAnalytics,
  type JolietRecord,
} from "./joliet-parser";
import {
  jolietTestAnalytics,
  jolietTestConfig,
  jolietTestContact,
  jolietTestInventory,
  jolietTestOwner,
  jolietTestRecord,
  jolietTestSearch,
  jolietDisagreementFixture,
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
      expect(new Headers(init?.headers).get("User-Agent")).toBe(
        "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0",
      );
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

function disagreementReplay(extraMissing = 0, allSavedDifferences = false) {
  const saved = jolietDisagreementFixture();
  const table = parseJolietInventory(saved.inventory);
  const f150 = parseJolietSearch(saved.f150, { make: "FORD", model: "F-150" });
  const sonata = parseJolietSearch(saved.sonata, {
    make: "HYUNDAI",
    model: "SONATA",
  });
  // Only the F-150 query and API-only Sonata are captured evidence. Supply
  // synthetic agreeing API identities for the remaining HTML stocks, rather
  // than presenting the bounded saved investigation as a complete API census.
  const captured = new Map(f150.map((record) => [record.stock, record]));
  const namedMissing = new Set(["STK077444", "STK077649"]);
  const agreeing = table.rows
    .slice(extraMissing)
    .filter((row) =>
      allSavedDifferences
        ? row.make !== "FORD" ||
          row.model !== "F-150" ||
          captured.has(row.stock)
        : !namedMissing.has(row.stock),
    )
    .map((row, index) => {
      const record = captured.get(row.stock);
      if (record) return record;
      const [month, day, year] = (row.sourceSetDate ?? "08.19.26").split(".");
      return {
        ...jolietTestRecord,
        stock: row.stock,
        year: row.year,
        make: row.make,
        model: row.model,
        vehicleRow: row.row,
        dateAdded: `20${year}-${month}-${day}T09:00:00`,
        vin: "1FAHP2J89EG" + String(400000 + index),
      };
    });
  const api = [
    ...agreeing,
    ...(allSavedDifferences
      ? f150.filter(
          (record) => !table.rows.some((row) => row.stock === record.stock),
        )
      : []),
    ...sonata,
  ];
  const searches = new Map(
    table.pairs.map((pair) => [
      jolietPairKey(pair),
      api.filter(
        (record) => record.make === pair.make && record.model === pair.model,
      ),
    ]),
  );
  if (allSavedDifferences)
    searches.set(jolietPairKey({ make: "FORD", model: "F-150" }), f150);
  mock({
    searches,
    rewrite: (body, kind) =>
      kind === "inventory"
        ? saved.inventory
        : kind === "analytics"
          ? jolietTestAnalytics(api)
          : body,
  });
  return { table, api, saved };
}

test("Joliet excludes and reports the three named saved stocks across durable chunks", async () => {
  const { table, api, saved } = disagreementReplay();
  expect(table.rows).toHaveLength(1411);
  expect(api).toHaveLength(1410);
  expect(parseJolietAnalytics(saved.analytics).count).toBe(1410);
  const vehicles: JolietCanonicalVehicle[] = [];
  const summary = await soakJolietInventory((cursor, budget) =>
    run(
      JolietCursorSchema.parse(JSON.parse(JSON.stringify(cursor))),
      budget,
      (batch) =>
        Effect.sync(() => {
          vehicles.push(...batch);
        }),
    ),
  );
  expect(summary.status).toBe("complete");
  expect(summary.count).toBe(1409);
  expect(summary.accounting).toEqual({
    recordsProcessed: 1412,
    recordsExcluded: 3,
    recordsRejected: 0,
    duplicateVehicles: 0,
  });
  expect(vehicles).toHaveLength(1409);
  for (const stock of ["STK077444", "STK077649", "STK076107"]) {
    expect(vehicles.some((vehicle) => vehicle.stockNumber === stock)).toBe(
      false,
    );
    expect(summary.warnings?.join(" ")).toContain(stock);
  }
  expect(summary.observedVins).not.toContain("5NPEC4AC8DH776155");
});

test("Joliet also accepts all eleven stock differences in the saved F-150 and Sonata evidence", async () => {
  disagreementReplay(0, true);
  const result = await soakJolietInventory((cursor, budget) =>
    run(cursor, budget),
  );
  expect(result.status).toBe("complete");
  expect(result.count).toBe(1405);
  expect(result.accounting).toEqual({
    recordsProcessed: 1417,
    recordsExcluded: 12,
    recordsRejected: 0,
    duplicateVehicles: 0,
  });
  for (const stock of [
    "STK077444",
    "STK077649",
    "STK077716",
    "STK077745",
    "STK077759",
    "STK077764",
    "STK076417",
    "STK076493",
    "STK076391",
    "STK076477",
    "STK076107",
  ])
    expect(result.warnings?.join(" ")).toContain(stock);
});

test("Joliet rejects the saved analytics' 25 year-count differences despite a net count difference of one", async () => {
  const saved = jolietDisagreementFixture();
  mock({
    rewrite: (body, kind) =>
      kind === "inventory"
        ? saved.inventory
        : kind === "analytics"
          ? saved.analytics
          : body,
  });
  await expect(Effect.runPromise(fetchJolietContext(gate))).rejects.toThrow(
    "1% disagreement",
  );
});

test("Joliet fails when the stock disagreement exceeds 1% even with reconciling API counts", async () => {
  disagreementReplay(12); // 15 / 1,411 exceeds 1%; net count difference is only 13.
  await expect(
    soakJolietInventory((cursor, budget) => run(cursor, budget)),
  ).rejects.toThrow("Stocks exceed the 1% disagreement limit");
});

test("Joliet accepts exactly 1% disagreement and resumes an empty own-query receipt", async () => {
  const records = Array.from({ length: 100 }, (_, index) => ({
    ...jolietTestRecord,
    stock: "STK" + String(75000 + index).padStart(6, "0"),
    vin: "1FAHP2J89EG" + String(117500 + index),
    model: index === 0 ? "A" : "Z",
  }));
  mock({
    records,
    searches: new Map([[jolietPairKey({ make: "FORD", model: "A" }), []]]),
    rewrite: (body, kind) =>
      kind === "analytics" ? jolietTestAnalytics(records.slice(1)) : body,
  });
  const first = await run(undefined, 1);
  expect(first.count).toBe(0);
  expect(first.cursor).toMatchObject({
    phase: "queries",
    seen: [],
    receipts: [{ count: 0, newStocks: 0 }],
  });
  const last = await run(
    JolietCursorSchema.parse(JSON.parse(JSON.stringify(first.cursor))),
    1,
  );
  expect(last.status).toBe("complete");
  expect(last.count).toBe(99);
  expect(last.accounting).toEqual({
    recordsProcessed: 100,
    recordsExcluded: 1,
    recordsRejected: 0,
    duplicateVehicles: 0,
  });
  expect(last.warnings?.join(" ")).toContain("STK075000");
});

test("Joliet still requires the complete API union to reconcile exactly with analytics", async () => {
  const records = Array.from({ length: 100 }, (_, index) => ({
    ...jolietTestRecord,
    stock: "STK" + String(75000 + index).padStart(6, "0"),
    vin: "1FAHP2J89EG" + String(117500 + index),
  }));
  mock({
    records,
    rewrite: (body, kind) =>
      kind === "analytics" ? jolietTestAnalytics(records.slice(1)) : body,
  });
  let callbacks = 0;
  await expect(
    run(undefined, 16, () =>
      Effect.sync(() => {
        callbacks++;
      }),
    ),
  ).rejects.toThrow("Terminal API stock union does not reconcile");
  expect(callbacks).toBe(0);
});

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

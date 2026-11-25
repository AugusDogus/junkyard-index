import { afterEach, expect, test } from "bun:test";
import { Effect, Either } from "effect";
import { z } from "zod";
import { soakJolietInventory } from "../../../scripts/soak-joliet";
import { fetchJolietContext } from "./joliet-client";
import { streamJolietInventoryWithRequestGate } from "./joliet-connector";
import { validationRejectionKind } from "./ingestion-validation";
import {
  JOLIET_MAX_RESTARTS,
  JolietCursor,
  JolietCursorSchema,
} from "./joliet-cursor";
import {
  JOLIET_MAX_QUERIES,
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
import { runWithQueuedHost } from "./provider-host-test-support";
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
    /** Fixed records, or the records published as of each context read. */
    records?:
      | readonly JolietRecord[]
      | ((ordinal: number) => readonly JolietRecord[]);
    searches?: Map<string, readonly JolietRecord[]>;
    rewrite?: (body: string, kind: Kind, ordinal: number) => string;
    response?: (body: string, kind: Kind) => Response;
  } = {},
) {
  const published = (ordinal: number) =>
    typeof options.records === "function"
      ? options.records(ordinal)
      : (options.records ?? [jolietTestRecord, second]);
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
        body = jolietTestInventory(published(contexts));
      } else if (url === JOLIET_CONFIG_URL) {
        kind = "config";
        body = jolietTestConfig;
      } else if (url === JOLIET_ANALYTICS_URL) {
        kind = "analytics";
        body = jolietTestAnalytics(published(contexts));
      } else if (url === JOLIET_SEARCH_URL) {
        kind = "search";
        expect(init?.method).toBe("POST");
        const query = querySchema.parse(
          JSON.parse(typeof init?.body === "string" ? init.body : ""),
        );
        const pair = { make: query.make, model: query.model };
        body = jolietTestSearch(
          options.searches?.get(jolietPairKey(pair)) ??
            published(contexts).filter(
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

test("Joliet accepts the saved analytics' 25 year-count differences (1.77%)", async () => {
  const saved = jolietDisagreementFixture();
  mock({
    rewrite: (body, kind) =>
      kind === "inventory"
        ? saved.inventory
        : kind === "analytics"
          ? saved.analytics
          : body,
  });
  const context = await Effect.runPromise(fetchJolietContext(gate));
  expect(context.rows).toHaveLength(1411);
  expect(context.counts.count).toBe(1410);
});

test("Joliet excludes and reports 25 stock differences (1.77%) against the saved HTML inventory", async () => {
  // Only two API queries were saved. Remaining identities and these additional
  // missing stocks are synthetic, rather than an asserted full API census.
  const { table, api } = disagreementReplay(22);
  const htmlStocks = new Set(table.rows.map((row) => row.stock));
  const apiStocks = new Set(api.map((record) => record.stock));
  const differences = [
    ...table.rows
      .filter((row) => !apiStocks.has(row.stock))
      .map((row) => row.stock),
    ...api
      .filter((record) => !htmlStocks.has(record.stock))
      .map((record) => record.stock),
  ];
  expect(differences).toHaveLength(25);
  const vehicles: JolietCanonicalVehicle[] = [];
  const result = await soakJolietInventory((cursor, budget) =>
    run(cursor, budget, (batch) =>
      Effect.sync(() => {
        vehicles.push(...batch);
      }),
    ),
  );
  expect(result.status).toBe("complete");
  expect(result.count).toBe(1387);
  expect(result.accounting?.recordsExcluded).toBe(25);
  for (const stock of differences) {
    expect(vehicles.some((vehicle) => vehicle.stockNumber === stock)).toBe(
      false,
    );
    expect(result.warnings?.join(" ")).toContain(stock);
  }
});

test("Joliet fails when the stock disagreement exceeds 5% even with reconciling API counts", async () => {
  disagreementReplay(68); // 71 / 1,411 exceeds 5%; API counts still reconcile.
  await expect(
    soakJolietInventory((cursor, budget) => run(cursor, budget)),
  ).rejects.toThrow("Stocks exceed the 5% disagreement limit");
});

test("Joliet accepts exactly 5% disagreement and resumes an empty own-query receipt", async () => {
  const records = Array.from({ length: 100 }, (_, index) => ({
    ...jolietTestRecord,
    stock: "STK" + String(75000 + index).padStart(6, "0"),
    vin: "1FAHP2J89EG" + String(117500 + index),
    model: index < 5 ? "A" : "Z",
  }));
  mock({
    records,
    searches: new Map([[jolietPairKey({ make: "FORD", model: "A" }), []]]),
    rewrite: (body, kind) =>
      kind === "analytics" ? jolietTestAnalytics(records.slice(5)) : body,
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
  expect(last.count).toBe(95);
  expect(last.accounting).toEqual({
    recordsProcessed: 100,
    recordsExcluded: 5,
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

/** Nov 25 07:00 UTC: Joliet re-set STK076422 (same stock, year and VIN) on
 * Nov 24. During the overnight publish the official table still showed its
 * earlier set date while the API showed the re-set date, which rejected the
 * whole yard at the first conflicting stock. */
function resetStockReplay(conflicts: number) {
  const reset = {
    ...jolietTestRecord,
    stock: "STK076422",
    year: 2013,
    make: "CHEVROLET",
    model: "CRUZE",
    vin: "1G1PC5SBXD7195726",
    vehicleRow: "75",
  };
  const others = Array.from({ length: 99 }, (_, index) => ({
    ...jolietTestRecord,
    stock: "STK" + String(75000 + index).padStart(6, "0"),
    vin: "1FAHP2J89EG" + String(117500 + index),
    model: index < 50 ? "A" : "Z",
  }));
  const records = [reset, ...others];
  // The fixture table renders every set date as 08.19.26. The API reports
  // the re-set date for the first `conflicts` stocks.
  const resetDate = <T extends JolietRecord>(record: T) => ({
    ...record,
    dateAdded: "2026-11-24T16:57:21.410",
  });
  const api = records.map((record, index) =>
    index < conflicts ? resetDate(record) : record,
  );
  const searches = new Map(
    [...new Set(records.map((record) => jolietPairKey(record)))].map((key) => [
      key,
      api.filter((record) => jolietPairKey(record) === key),
    ]),
  );
  // The re-set stock also matches an overlapping query, so its quarantine must
  // agree across repeats.
  const overlapping = jolietPairKey({ make: "FORD", model: "A" });
  searches.set(overlapping, [
    ...(searches.get(overlapping) ?? []),
    resetDate(reset),
  ]);
  mock({ records, searches });
  return reset;
}

test("Joliet quarantines a re-set stock whose set date conflicts across a durable crawl", async () => {
  const reset = resetStockReplay(1);
  const vehicles: JolietCanonicalVehicle[] = [];
  const result = await soakJolietInventory((cursor) =>
    run(
      JolietCursorSchema.parse(JSON.parse(JSON.stringify(cursor))),
      1,
      (batch) =>
        Effect.sync(() => {
          vehicles.push(...batch);
        }),
    ),
  );
  expect(result.status).toBe("complete");
  expect(result.count).toBe(99);
  expect(result.accounting).toEqual({
    recordsProcessed: 101,
    recordsExcluded: 2,
    recordsRejected: 0,
    duplicateVehicles: 0,
  });
  expect(vehicles).toHaveLength(99);
  expect(vehicles.some((vehicle) => vehicle.stockNumber === reset.stock)).toBe(
    false,
  );
  // Presence keeps its prior published listing without changing its fields.
  expect(result.observedVins).toEqual([reset.vin]);
  expect(result.warnings?.join(" ")).toContain(
    "STK076422 (table row 75, set 08.19.26; API row 75, set 11.24.26)",
  );
});

test("Joliet quarantines a native row conflict the same way", async () => {
  mock({
    searches: new Map([
      [jolietPairKey(second), [{ ...second, vehicleRow: "77" }]],
    ]),
    records: [
      jolietTestRecord,
      second,
      ...Array.from({ length: 30 }, (_, index) => ({
        ...jolietTestRecord,
        stock: "STK" + String(76000 + index).padStart(6, "0"),
        vin: "1FAHP2J89EG" + String(118000 + index),
      })),
    ],
  });
  const result = await run();
  expect(result.status).toBe("complete");
  expect(result.count).toBe(31);
  expect(result.observedVins).toEqual([second.vin]);
  expect(result.warnings?.join(" ")).toContain(
    "STK075103 (table row 99, set 08.19.26; API row 77, set 08.19.26)",
  );
});

test("Joliet still fails when conflicting stocks exceed the 5% disagreement limit", async () => {
  resetStockReplay(6);
  await expect(
    soakJolietInventory((cursor, budget) => run(cursor, budget)),
  ).rejects.toThrow("Stocks exceed the 5% disagreement limit");
});

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
    { ...cursor, restarts: 1 },
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

test("Joliet rejects owner/scope drift on resume after its last restart and at terminal closing", async () => {
  mock();
  const first = await run(undefined, 1);
  if (first.cursor.phase !== "queries")
    throw new Error("Expected query checkpoint");
  const exhausted = JolietCursor.checkpoint({
    ...first.cursor,
    restarts: JOLIET_MAX_RESTARTS,
  });
  mock({
    rewrite: (body, kind) =>
      kind === "inventory" ? body.replace("<td>99</td>", "<td>98</td>") : body,
  });
  const drift: unknown = await run(exhausted).catch((error: unknown) => error);
  expect(() => {
    throw drift;
  }).toThrow("changed during the crawl");
  // The overnight publish settles, so a crawl later today can pass.
  expect(validationRejectionKind(drift)).toBe("transient");
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

const third = {
  ...jolietTestRecord,
  stock: "STK075104",
  vin: "1FAHP2J89EG117596",
  model: "FOCUS",
};
/** Records whose official table and counts change with each context read. */
const republished = (ordinal: number) => [
  jolietTestRecord,
  second,
  {
    ...third,
    stock: "STK07511" + String(ordinal),
    vin: "1FAHP2J89EG11760" + String(ordinal),
  },
];
/** Runs one chunk and stages its vehicles as the durable repository does: a
 * restart chunk supersedes everything staged before it. */
async function stageChunk(
  staged: readonly string[],
  cursor: JolietCursor,
  maxPages: number,
) {
  const batch: JolietCanonicalVehicle[] = [];
  const result = await run(
    JolietCursorSchema.parse(JSON.parse(JSON.stringify(cursor))),
    maxPages,
    (vehicles) =>
      Effect.sync(() => {
        batch.push(...vehicles);
      }),
  );
  return {
    result,
    staged: [
      ...(result.restart ? [] : staged),
      ...batch.map((vehicle) => vehicle.vin),
    ],
  };
}

/** The complete cursor written before restarts existed. Code rolled back past
 * restarts unions every staged chunk, so it must reject a restarted run's
 * terminal cursor instead of publishing superseded vehicles. */
const PreRestartCompleteSchema = z
  .object({ source: z.literal("joliet"), phase: z.literal("complete") })
  .strict();
function expectRestartedCompletion(cursor: JolietCursor, restarts: number) {
  expect(cursor).toEqual({ source: "joliet", phase: "complete", restarts });
  expect(JolietCursorSchema.parse(cursor)).toEqual(cursor);
  expect(PreRestartCompleteSchema.safeParse(cursor).success).toBe(false);
}

/** The overnight publish lands between the first and second chunks and
 * removes the stock the first query found. */
function publishBetweenChunks() {
  const before = [jolietTestRecord, second, third];
  const firstPair = parseJolietInventory(jolietTestInventory(before)).pairs[0];
  const removed = before.find((record) => record.model === firstPair?.model);
  if (!removed) throw new Error("Missing first-query fixture");
  const after = [
    ...before.filter((record) => record !== removed),
    {
      ...jolietTestRecord,
      stock: "STK075105",
      vin: "1FAHP2J89EG117597",
      model: "ESCAPE",
    },
  ];
  mock({ records: (ordinal) => (ordinal < 2 ? before : after) });
  return { removed, after };
}

test("Joliet restarts from query 0 when the official context changes between chunks", async () => {
  const { removed, after } = publishBetweenChunks();
  let { result, staged } = await stageChunk([], JolietCursor.initial, 1);
  expect(result.restart).toBeUndefined();
  expect(staged).toEqual([removed.vin]);

  ({ result, staged } = await stageChunk(staged, result.cursor, 1));
  expect(result.restart).toBe(true);
  expect(result.cursor).toMatchObject({
    phase: "queries",
    restarts: 1,
    nextQuery: 1,
  });
  // The restart searched the new context's first pair, not the old resume pair.
  const restartPair = parseJolietInventory(jolietTestInventory(after)).pairs[0];
  if (result.cursor.phase !== "queries")
    throw new Error("Expected query checkpoint");
  expect(result.cursor.seen.map((entry) => entry.stock)).toEqual(
    after
      .filter((record) => record.model === restartPair?.model)
      .map((record) => record.stock),
  );
  expect(result.warnings?.join(" ")).toContain("restarted");

  while (result.status === "paused")
    ({ result, staged } = await stageChunk(staged, result.cursor, 16));
  expect(result.status).toBe("complete");
  expect(result.restart).toBeUndefined();
  expectRestartedCompletion(result.cursor, 1);
  expect(staged.sort()).toEqual(after.map((record) => record.vin).sort());
  expect(staged).not.toContain(removed.vin);
});

test("Joliet soak clears its caller's collected vehicles when a chunk restarts", async () => {
  const { removed, after } = publishBetweenChunks();
  const collected = new Set<string>();
  let resets = 0;
  const summary = await soakJolietInventory(
    (cursor, _budget, onBatch) => run(cursor, 1, onBatch),
    JOLIET_MAX_QUERIES,
    {
      add: (vehicles) => {
        for (const vehicle of vehicles) collected.add(vehicle.vin);
      },
      reset: () => {
        resets++;
        collected.clear();
      },
    },
  );
  expect(summary.status).toBe("complete");
  expect(resets).toBe(1);
  expect([...collected].sort()).toEqual(
    after.map((record) => record.vin).sort(),
  );
  expect(collected.has(removed.vin)).toBe(false);
  expect(summary.count).toBe(after.length);
});

test("Joliet restarts when the terminal closing context differs and publishes only the new context", async () => {
  const before = [jolietTestRecord, second];
  const after = [
    jolietTestRecord,
    { ...second, stock: "STK075106", vin: "1FAHP2J89EG117598" },
  ];
  // The publish lands after the last search and before its closing context.
  mock({ records: (ordinal) => (ordinal < 2 ? before : after) });
  let { result, staged } = await stageChunk([], JolietCursor.initial, 16);
  expect(result).toMatchObject({
    status: "paused",
    restart: true,
    count: 0,
    observedVins: [],
    cursor: { source: "joliet", phase: "restart", restarts: 1 },
    accounting: {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    },
  });
  expect(staged).toEqual([]);

  ({ result, staged } = await stageChunk(staged, result.cursor, 16));
  expect(result.status).toBe("complete");
  expect(result.restart).toBeUndefined();
  expectRestartedCompletion(result.cursor, 1);
  expect(staged.sort()).toEqual(after.map((record) => record.vin).sort());
});

test("Joliet fails on a third context change between chunks", async () => {
  mock({ records: republished });
  let cursor = (await run(undefined, 1)).cursor;
  for (const restarts of [1, 2]) {
    const result = await run(cursor, 1);
    expect(result.restart).toBe(true);
    expect(result.cursor).toMatchObject({ phase: "queries", restarts });
    cursor = result.cursor;
  }
  let callbacks = 0;
  await expect(
    run(cursor, 1, () =>
      Effect.sync(() => {
        callbacks++;
      }),
    ),
  ).rejects.toThrow("changed during the crawl");
  expect(callbacks).toBe(0);
});

test("Joliet fails on a third terminal closing change", async () => {
  mock({ records: republished });
  let cursor: JolietCursor = JolietCursor.initial;
  for (const restarts of [1, 2]) {
    const result = await run(cursor, 16);
    expect(result.cursor).toEqual({
      source: "joliet",
      phase: "restart",
      restarts,
    });
    cursor = result.cursor;
  }
  await expect(run(cursor, 16)).rejects.toThrow("changed during the crawl");
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

test("Joliet completes a crawl when every VinPlus turn waits minutes", async () => {
  // About 20 sources share the VinPlus lease at 07:00, so each turn waits
  // about 2.5 minutes. A resumed terminal chunk used to need five turns
  // (config, analytics, last search, closing config, closing analytics) and
  // hit the wall limit.
  const records = Array.from({ length: 6 }, (_, index) => ({
    ...jolietTestRecord,
    stock: "STK" + String(75000 + index).padStart(6, "0"),
    vin: "1FAHP2J89EG" + String(117500 + index),
    model: "MODEL " + String.fromCharCode(65 + index),
  }));
  const requests = mock({ records });
  let cursor: JolietCursor = JolietCursor.initial;
  let vehicles: JolietCanonicalVehicle[] = [];
  const chunks: { status: string; elapsedMs: number }[] = [];
  while (cursor.phase !== "complete" && chunks.length < 8) {
    const chunk = await runWithQueuedHost(
      streamJolietInventoryWithRequestGate(
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
    cursor = JolietCursorSchema.parse(
      JSON.parse(JSON.stringify(chunk.result.right.cursor)),
    );
  }
  expect(cursor.phase).toBe("complete");
  expect(vehicles).toHaveLength(6);
  // Every chunk returns well inside an 800 s function started inline late.
  expect(chunks.every((chunk) => chunk.elapsedMs <= 6 * 60_000)).toBe(true);
  // The closing context still follows the last search.
  expect(requests.slice(-6)).toEqual([
    "search",
    "owner",
    "contact",
    "inventory",
    "config",
    "analytics",
  ]);
}, 120_000);

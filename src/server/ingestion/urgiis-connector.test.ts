import { expect, test } from "bun:test";
import { Effect, TestClock, TestContext } from "effect";
import { UrgiisEntrySchema, urgiisFingerprint } from "./urgiis-traversal";
import { UrgiisCursor, URGIIS_MAX_CURSOR_BYTES } from "./urgiis-cursor";
import { streamUrgiisInventory, urgiisChunkTenant } from "./urgiis-connector";
import { urgiisError } from "./urgiis-client";
import {
  urgiisSnapshot,
  validateUrgiisSnapshot,
  type UrgiisTenant,
} from "./urgiis-snapshot";
import { iisCards, iisDirectory } from "./urgiis-catalog";

const tenant: UrgiisTenant = {
  code: "fixture",
  origin: "https://example.com",
  urgid: "AA01",
  pathStyle: "parts",
  makesPath: "/parts/makes/",
  arrivalsPath: "/recent-arrivals/",
  ownerPath: "/",
  ownerClaims: ["Test Yard", "123 Main St"],
  cookie: null,
  pacingMs: 2200,
  requestTimeoutMs: 40_000,
  minimumInventory: 1,
  photoCodes: ["aa01"],
  skipBlankVin: false,
  placeholderStocks: [],
  attribution: { kind: "site" },
  yard: {
    source: "urgiis",
    code: "fixture",
    name: "Test Yard",
    operator: "Test Yard",
    address: "123 Main St",
    city: "Test City",
    state: "MA",
    postalCode: "01001",
    lat: 42,
    lng: -71,
    phone: null,
    email: null,
    websiteUrl: "https://example.com/",
  },
};
const make = { path: "/parts/ACURA", label: "ACURA", count: 1 };
const model = { path: "/parts/ACURA/ILX/", label: "ILX", count: 1 };
const document = (body: string) =>
  `<html><head><title>Recent Arrivals</title></head><body><script>var urgid = 'AA01';</script>Test Yard 123 Main St<div id="iiscont">${body}</div></body></html>`;
const link = (path: string, label: string, count: number) =>
  `<a href="${path}">${label}<span class="badge">${count}</span></a>`;
const makes = document(
  `<div class="iisMakesMenu">${link(make.path, make.label, 1)}</div>`,
);
const menu = document(
  `<div id="menumodellist">${link(model.path, model.label, 1)}</div>`,
);
const card = (vin = "19UDE2F70GA016398", year = "2016", stock = "JC8438") =>
  `<div class="card-price"><div class="card-img"><img src="https://da8h1v3w8q6n5.cloudfront.net/aa01/images/${stock}/a.jpg"></div><div class="car-details"><b>Stock:</b>${stock}<br><b>Year:</b>${year}<br><b>Make/Model:</b>ACURA ILX<br><b>VIN:</b>${vin}<br></div><a href="/parts/ACURA/ILX/${stock}/${year}">See Parts</a><button data-vehicle="${year} ACURA ILX - VIN ${vin}">Inquire</button></div>`;
const page = document(`<div class="card-deck">${card()}</div>`);
const responses = [
  document(""),
  makes,
  document("No Results Found. Try Browsing Our Parts Or Search Again"),
  menu,
  page,
  document(""),
  makes,
  menu,
];

test("URG used-parts make directories use their canonical trailing slash", () => {
  const site = { ...tenant, pathStyle: "used-parts" as const };
  const raw = makes.replaceAll("/parts/", "/used-parts/");
  expect(iisDirectory(raw, site)).toEqual([
    { ...make, path: "/used-parts/ACURA/" },
  ]);
  expect(iisDirectory(makes, tenant)).toEqual([make]);
});

test("URG IIS accepts known arrivals titles and rejects unknown variants", () => {
  for (const title of [
    "Recent Arrivals",
    "Latest Arrivals",
    "Latest Used Auto Parts Arrivals",
    "Latest Used Auto Parts Arrivals | A-Z Auto Parts",
  ]) {
    expect(
      iisCards(page.replace("Recent Arrivals", title), tenant, "arrivals")
        .records,
    ).toHaveLength(1);
  }
  for (const title of [
    "Used Auto Parts",
    "Latest Used Auto Parts Arrivals | Unknown Yard",
    "Latest Retail Auto Sales Arrivals",
  ]) {
    expect(() =>
      iisCards(page.replace("Recent Arrivals", title), tenant, "arrivals"),
    ).toThrow("IIS native arrivals title is missing or changed");
  }
});

test("URG IIS publishes observed donors through one-car badge additions and removals", async () => {
  for (const [openingCount, closingCount] of [
    [1, 2],
    [2, 1],
    [1, 4],
  ]) {
    let reads = 0;
    let batches = 0;
    let cursor = UrgiisCursor.initial([tenant]);
    while (cursor.phase !== "complete") {
      const result = await Effect.runPromise(
        streamUrgiisInventory({
          tenants: [tenant],
          startCursor: cursor,
          maxPages: 1,
          readPage: () => {
            const index = reads++;
            return Effect.succeed(
              (responses[index] ?? "").replace(
                ">1<",
                `>${index < 5 ? openingCount : closingCount}<`,
              ),
            );
          },
          onBatch: (vehicles) =>
            Effect.sync(() => {
              expect(vehicles.map((v) => v.vin)).toEqual(["19UDE2F70GA016398"]);
              batches++;
            }),
        }),
      );
      expect(result.errors).toEqual([]);
      cursor = UrgiisCursor.fromWire(
        UrgiisCursor.serialize(result.cursor, [tenant]),
        [tenant],
      );
    }
    expect(reads).toBe(8);
    expect(batches).toBe(1);
  }
});

test("URG IIS resumes tenants, requires closing evidence, and never refetches a complete cursor", async () => {
  let reads = 0;
  let batches = 0;
  let cursor = UrgiisCursor.initial([tenant]);
  const urls = [
    "/",
    "/parts/makes/",
    "/recent-arrivals/",
    make.path,
    model.path,
    "/",
    "/parts/makes/",
    make.path,
  ];
  const reader = (url: string) => {
    expect(url).toBe(tenant.origin + urls[reads]);
    const raw = responses[reads++];
    return raw
      ? Effect.succeed(raw)
      : Effect.fail(urgiisError("fixture", "Unexpected request"));
  };
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamUrgiisInventory({
        tenants: [tenant],
        startCursor: cursor,
        maxPages: 1,
        readPage: reader,
        onBatch: (vs) =>
          Effect.sync(() => {
            expect(reads).toBe(8);
            expect(vs).toHaveLength(1);
            expect(vs[0]?.stateAbbr).toBe("MA");
            batches++;
          }),
      }),
    );
    cursor = UrgiisCursor.fromWire(
      UrgiisCursor.serialize(result.cursor, [tenant]),
      [tenant],
    );
  }
  expect(batches).toBe(1);
  expect(reads).toBe(8);
  await Effect.runPromise(
    streamUrgiisInventory({
      tenants: [tenant],
      startCursor: cursor,
      readPage: reader,
      onBatch: () =>
        Effect.sync(() => {
          batches++;
        }),
    }),
  );
  expect(batches).toBe(1);
  expect(reads).toBe(8);
});

test("URG IIS resumes a transient model failure from the saved frontier before emitting", async () => {
  let reads = 0;
  let batches = 0;
  let cursor = UrgiisCursor.initial([tenant]);
  const run = (failModel: boolean) =>
    Effect.runPromise(
      streamUrgiisInventory({
        tenants: [tenant],
        startCursor: cursor,
        maxPages: 1,
        readPage: (url) => {
          if (failModel) {
            expect(url).toBe(tenant.origin + model.path);
            return Effect.fail(urgiisError("request/body " + url, "HTTP500"));
          }
          const raw = responses[reads++];
          return raw
            ? Effect.succeed(raw)
            : Effect.fail(urgiisError("fixture", "Unexpected request"));
        },
        onBatch: (vehicles) =>
          Effect.sync(() => {
            expect(reads).toBe(responses.length);
            expect(vehicles.map((v) => v.vin)).toEqual(["19UDE2F70GA016398"]);
            batches++;
          }),
      }),
    );
  while (reads < 4) cursor = (await run(false)).cursor;
  const saved = UrgiisCursor.serialize(cursor, [tenant]);
  await expect(run(true)).rejects.toThrow("HTTP500");
  expect(UrgiisCursor.serialize(cursor, [tenant])).toEqual(saved);
  expect(batches).toBe(0);
  cursor = UrgiisCursor.fromWire(saved, [tenant]);
  while (cursor.phase !== "complete") cursor = (await run(false)).cursor;
  expect(reads).toBe(responses.length);
  expect(batches).toBe(1);
});

test("URG IIS accumulates model badge drift across resumed closing menus and fails without retrying", async () => {
  const secondModelPath = "/parts/OTHER/ILX/";
  const fixture = [
    document(""),
    makes.replace("</div>", `${link("/parts/OTHER", "OTHER", 1)}</div>`),
    responses[2] ?? "",
    menu,
    menu.replaceAll("/parts/ACURA", "/parts/OTHER"),
    page,
    page.replaceAll("/parts/ACURA/ILX/", secondModelPath),
    document(""),
    makes.replace("</div>", `${link("/parts/OTHER", "OTHER", 1)}</div>`),
    menu.replace(">1<", ">3<"),
    menu.replaceAll("/parts/ACURA", "/parts/OTHER").replace(">1<", ">3<"),
  ];
  let reads = 0;
  let batches = 0;
  let cursor = UrgiisCursor.initial([tenant]);
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamUrgiisInventory({
        tenants: [tenant],
        startCursor: cursor,
        maxPages: 1,
        readPage: () => Effect.succeed(fixture[reads++] ?? ""),
        onBatch: () =>
          Effect.sync(() => {
            batches++;
          }),
      }),
    );
    if (result.status === "failed") {
      expect(result.errors.join(" ")).toContain("models badges changed by 4");
      expect(result.pagesProcessed).toBe(1);
      expect(reads).toBe(fixture.length);
      expect(batches).toBe(0);
      return;
    }
    cursor = UrgiisCursor.fromWire(
      UrgiisCursor.serialize(result.cursor, [tenant]),
      [tenant],
    );
  }
  throw new Error("Expected terminal closing failure");
});
test("URG IIS fails closed on directory drift, source mixing, caps and corrupt checkpoints", async () => {
  for (const [changedIndex, changed] of [
    [5, document("").replace("123 Main St", "456 Other St")],
    [6, makes.replace(">ACURA<", ">Acura<")],
    [6, makes.replace("/parts/ACURA", "/parts/OTHER")],
    [6, makes.replace(">1<", ">5<")],
    [7, menu.replace(">1<", ">5<")],
    [7, menu.replace(model.label, "OTHER")],
    [
      7,
      menu.replace(
        "</div>",
        `${link("/parts/ACURA/OTHER/", "OTHER", 1)}</div>`,
      ),
    ],
    [4, document(`<div class="card-deck">${card().repeat(500)}</div>`)],
  ] as const) {
    let reads = 0;
    let batches = 0;
    let cursor = UrgiisCursor.initial([tenant]);
    let failure: unknown;
    let failedStatus = false;
    try {
      while (cursor.phase !== "complete") {
        const result = await Effect.runPromise(
          streamUrgiisInventory({
            tenants: [tenant],
            startCursor: cursor,
            maxPages: 3,
            readPage: () => {
              const index = reads++;
              return Effect.succeed(
                index === changedIndex ? changed : (responses[index] ?? ""),
              );
            },
            onBatch: () =>
              Effect.sync(() => {
                batches++;
              }),
          }),
        );
        if (result.status === "failed") {
          failedStatus = true;
          throw new Error(result.errors.join("; "));
        }
        cursor = result.cursor;
      }
    } catch (cause) {
      failure = cause;
    }
    expect(failure).toBeDefined();
    expect(batches).toBe(0);
    expect(reads).toBe(changedIndex + 1);
    expect(failedStatus).toBe(changedIndex > 4);
  }
  expect(() =>
    iisCards(page.replaceAll("'AA01'", "'FOREIGN'"), tenant),
  ).toThrow("supplier");
  const cursor = UrgiisCursor.initial([tenant]);
  expect(() =>
    UrgiisCursor.parse({ ...cursor, scope: "changed" }, [tenant]),
  ).toThrow();
  expect(() =>
    UrgiisCursor.parse(cursor, [{ ...tenant, urgid: "OTHER" }]),
  ).toThrow();
  expect(() =>
    iisDirectory(
      makes.replace("/parts/ACURA", "https://evil.example/parts/ACURA"),
      tenant,
    ),
  ).toThrow();
});
test("URG IIS quarantines VIN/destination contradictions and enforces the ten-percent rejection guard", () => {
  const records = iisCards(page, tenant).records;
  const original = records[0];
  if (!original) throw new Error("missing fixture donor");
  const pages = [
    {
      make,
      model,
      records: [original, { ...original, years: ["2015"] }],
      hash: "",
    },
  ];
  const snapshot = urgiisSnapshot(pages, tenant);
  expect(snapshot.vehicles).toHaveLength(0);
  expect(snapshot.accounting.recordsRejected).toBe(2);
  expect(snapshot.observedVins).toContain("19UDE2F70GA016398");
  expect(() => validateUrgiisSnapshot(snapshot, tenant)).toThrow("admission");
});
test("URG IIS excludes only configured blank-VIN placeholders and foreign or unassignable network cards", () => {
  const records = iisCards(page, tenant).records;
  const original = records[0];
  if (!original) throw new Error("missing fixture donor");
  const rows = [
    original,
    { ...original, vins: [""], inquiries: [] },
    {
      ...original,
      image: "https://da8h1v3w8q6n5.cloudfront.net/other/images/x.jpg",
    },
    { ...original, image: null },
  ];
  const snapshot = urgiisSnapshot([{ make, model, records: rows, hash: "" }], {
    ...tenant,
    skipBlankVin: true,
    photoCodes: ["aa01"],
    attribution: { kind: "photo" },
  });
  expect(snapshot.vehicles).toHaveLength(1);
  expect(snapshot.accounting.recordsExcluded).toBe(3);
  expect(snapshot.accounting.recordsRejected).toBe(0);
  const numeric = urgiisSnapshot(
    [
      {
        make,
        model,
        records: [{ ...original, stock: "12345", vins: [""], inquiries: [] }],
        hash: "",
      },
    ],
    tenant,
  );
  expect(numeric.accounting.recordsExcluded).toBe(0);
  expect(numeric.accounting.recordsRejected).toBe(1);
});

test("URG IIS refuses shared supplier photos on a qualified single-yard catalog", () => {
  const records = iisCards(page, tenant).records.map((record) => ({
    ...record,
    image: "https://da8h1v3w8q6n5.cloudfront.net/foreign/images/a.jpg",
  }));
  expect(() =>
    urgiisSnapshot([{ make, model, records, hash: "" }], tenant),
  ).toThrow("unexpected supplier");
});

test("URG IIS excludes qualified part bins without hiding identifiable or numeric-stock donors", () => {
  const original = iisCards(page, tenant).records[0];
  if (!original) throw new Error("missing donor fixture");
  const snapshot = urgiisSnapshot(
    [
      {
        make,
        model,
        hash: "",
        records: [
          { ...original, stock: "166C", vins: [""], inquiries: [], image: "" },
          {
            ...original,
            stock: "123456",
            vins: [""],
            inquiries: [],
            image: "",
          },
          { ...original, stock: "166C" },
        ],
      },
    ],
    { ...tenant, placeholderStocks: ["166C"] },
  );
  expect(snapshot.accounting.recordsExcluded).toBe(1);
  expect(snapshot.accounting.recordsRejected).toBe(2);
});

test("URG IIS preserves the completed tenant prefix across yard boundaries", async () => {
  const second: UrgiisTenant = {
    ...tenant,
    code: "second",
    yard: { ...tenant.yard, code: "second" },
  };
  const tenants = [tenant, second];
  let cursor = UrgiisCursor.initial(tenants);
  let censusState: unknown;
  const emitted: string[] = [];
  let reads = 0;
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamUrgiisInventory({
        tenants,
        censusState,
        startCursor: cursor,
        maxPages: 3,
        readPage: () =>
          Effect.succeed(responses[reads++ % responses.length] ?? ""),
        onBatch: (vehicles) =>
          Effect.sync(() => {
            emitted.push(...vehicles.map((v) => v.locationCode));
          }),
      }),
    );
    cursor = UrgiisCursor.fromWire(
      UrgiisCursor.serialize(result.cursor, tenants),
      tenants,
    );
    censusState = result.checkpointState ?? censusState;
    if (emitted.length === 1) {
      expect(cursor.completed).toEqual([{ code: "fixture", accepted: 1 }]);
      expect(cursor.phase).not.toBe("complete");
    }
  }
  expect(emitted).toEqual(["fixture", "second"]);
  expect(reads).toBe(16);
  expect(cursor.completed).toEqual([
    { code: "fixture", accepted: 1 },
    { code: "second", accepted: 1 },
  ]);
});

test("URG IIS refuses an empty model at the known native cap boundary", async () => {
  let reads = 0;
  let emitted = false;
  let cursor = UrgiisCursor.initial([tenant]);
  const capped = [
    document(""),
    makes,
    document("No Results Found. Try Browsing Our Parts Or Search Again"),
    menu.replace(">1<", ">500<"),
    document("No Results Found. Try Browsing Our Parts Or Search Again"),
  ];
  await expect(
    (async () => {
      while (cursor.phase !== "complete") {
        const result = await Effect.runPromise(
          streamUrgiisInventory({
            tenants: [tenant],
            startCursor: cursor,
            maxPages: 3,
            readPage: () => Effect.succeed(capped[reads++] ?? ""),
            onBatch: () =>
              Effect.sync(() => {
                emitted = true;
              }),
          }),
        );
        cursor = result.cursor;
      }
    })(),
  ).rejects.toThrow("explicit empty result");
  expect(reads).toBe(5);
  expect(emitted).toBe(false);
});

test("URG IIS enforces rejection and duplicate limits independently of floors and exclusions", () => {
  const make = { path: "/parts/FORD", label: "FORD", count: 10 };
  const model = { path: "/parts/FORD/MUSTANG/", label: "MUSTANG", count: 10 };
  const donors = Array.from({ length: 9 }, (_, i) => ({
    years: ["1965"],
    titles: ["FORD MUSTANG"],
    vins: [`5F07C${100000 + i}`],
    inquiries: [],
    destinations: [`https://example.com/parts/FORD/MUSTANG/C${i}/1965`],
    stock: `C${i}`,
    image: null,
    date: null,
  }));
  const original = donors[0];
  if (!original) throw new Error("Missing serial fixture");
  const invalid = {
    ...original,
    vins: [""],
    stock: "bad",
    destinations: ["https://example.com/parts/FORD/MUSTANG/bad/1965"],
  };
  const snapshot = (records: typeof donors) =>
    urgiisSnapshot([{ make, model, records, hash: "" }], {
      ...tenant,
      placeholderStocks: ["166C"],
    });
  const boundary = snapshot([...donors, invalid]);
  expect(boundary.vehicles).toHaveLength(9);
  expect(boundary.accounting.recordsRejected).toBe(1);
  expect(() => validateUrgiisSnapshot(boundary, tenant)).not.toThrow();
  const bins = Array.from({ length: 100 }, () => ({
    ...invalid,
    stock: "166C",
  }));
  const rejected = snapshot([...donors, invalid, invalid, ...bins]);
  expect(rejected.accounting.recordsExcluded).toBe(100);
  expect(() => validateUrgiisSnapshot(rejected, tenant)).toThrow("admission");
  const duplicated = snapshot([
    ...donors,
    original,
    original,
    original,
    original,
  ]);
  expect(duplicated.accounting.duplicateVehicles).toBe(4);
  expect(() => validateUrgiisSnapshot(duplicated, tenant)).toThrow("admission");
});

test("URG IIS cannot qualify an arrivals window without admitted own-yard model donors", () => {
  const arrivals = iisCards(page, tenant).records;
  const snapshot = urgiisSnapshot(
    [{ make, model, records: [], hash: "" }],
    tenant,
    new Map(),
    arrivals,
  );
  expect(snapshot.vehicles).toHaveLength(1);
  expect(snapshot.modeledVehicles).toBe(0);
  expect(() => validateUrgiisSnapshot(snapshot, tenant)).toThrow(
    "0 from model pages",
  );
});

test("URG IIS retries an ordinary badged empty and blocks its cold tenant", async () => {
  let cursor = UrgiisCursor.initial([tenant]);
  let modelReads = 0;
  let published = false;
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamUrgiisInventory({
        tenants: [tenant],
        startCursor: cursor,
        maxPages: 1,
        readPage: (url) => {
          if (url === tenant.origin + model.path) {
            modelReads++;
            return Effect.succeed(
              document(
                "No Results Found. Try Browsing Our Parts Or Search Again",
              ),
            );
          }
          const index = responses.findIndex(
            (_, i) =>
              [
                tenant.origin + tenant.ownerPath,
                tenant.origin + tenant.makesPath,
                tenant.origin + tenant.arrivalsPath,
                tenant.origin + make.path,
              ][i] === url,
          );
          return Effect.succeed(
            index === 3
              ? menu.replace(">1<", ">91<")
              : (responses[index] ?? ""),
          );
        },
        onBatch: () =>
          Effect.sync(() => {
            published = true;
          }),
      }),
    );
    cursor = result.cursor;
  }
  expect(modelReads).toBe(2);
  expect(cursor.completed[0]).toMatchObject({
    blocked: expect.stringContaining("later retry"),
  });
  expect(published).toBe(false);
});

test("arrivals-only donors link to the page that displays them; modeled donors keep their native detail", () => {
  const modeled = iisCards(page, tenant).records;
  const arrivals = iisCards(
    document(card("19UDE2F70GA016398", "2016", "ARRIVAL")),
    tenant,
    "arrivals",
  ).records;
  const snapshot = urgiisSnapshot(
    [{ make, model, records: modeled, hash: "" }],
    tenant,
    new Map(),
    arrivals,
  );
  // Conflicting stocks for the same VIN quarantine both claims, even with a fallback URL.
  expect(snapshot.vehicles).toHaveLength(0);
  const only = urgiisSnapshot([], tenant, new Map(), modeled);
  expect(only.vehicles[0]?.detailsUrl).toBe(
    tenant.origin + tenant.arrivalsPath,
  );
  const both = urgiisSnapshot(
    [{ make, model, records: modeled, hash: "" }],
    tenant,
    new Map(),
    modeled,
  );
  expect(both.vehicles[0]?.detailsUrl).toBe(
    tenant.origin + "/parts/ACURA/ILX/JC8438/2016",
  );
});

test("URG IIS checkpoints Retry-After without advancing or requesting during the durable wait", async () => {
  let reads = 0;
  const result = await Effect.runPromise(
    streamUrgiisInventory({
      tenants: [tenant],
      now: 1000,
      readPage: () => {
        reads++;
        return Effect.fail({
          ...urgiisError("request", "HTTP429"),
          kind: "blocked" as const,
          status: 429 as const,
          retryAfterMs: 3600_000,
        });
      },
      onBatch: () => Effect.die("Blocked tenant must not publish"),
    }),
  );
  expect(result.status).toBe("paused");
  expect(result.warnings.join(" ")).toContain("HTTP429");
  expect(result.cursor.retryAt).toBe(3_601_000);
  expect(reads).toBe(1);
  const resumed = await Effect.runPromise(
    streamUrgiisInventory({
      tenants: [tenant],
      now: 2000,
      startCursor: UrgiisCursor.fromWire(
        UrgiisCursor.serialize(result.cursor, [tenant]),
        [tenant],
      ),
      readPage: () => Effect.die("Must honor the saved provider cooldown"),
      onBatch: () => Effect.die("Must not publish during a provider cooldown"),
    }),
  );
  expect(resumed.status).toBe("paused");
  expect(resumed.pagesProcessed).toBe(0);
  expect(resumed.cursor.retryAt).toBe(3_601_000);
});

test("URG IIS rejects a legacy checkpoint containing a badged empty model", async () => {
  let cursor = UrgiisCursor.initial([tenant]);
  let reads = 0;
  for (let i = 0; i < 4; i++) {
    cursor = (
      await Effect.runPromise(
        streamUrgiisInventory({
          tenants: [tenant],
          startCursor: cursor,
          maxPages: 1,
          now: 1000,
          readPage: () => Effect.succeed(responses[reads++] ?? ""),
          onBatch: () => Effect.die("Cannot publish an incomplete graph"),
        }),
      )
    ).cursor;
  }
  if (cursor.phase !== "opening") throw new Error("Expected a model frontier");
  expect(() =>
    UrgiisCursor.checkpoint(
      {
        ...cursor,
        entries: [
          ...cursor.entries.map((e) =>
            e.kind === "menu"
              ? { ...e, controls: [{ ...model, count: 91 }] }
              : e,
          ),
          {
            kind: "model",
            url: tenant.origin + model.path,
            records: [],
            bytes: 1,
            freshness: { kind: "read", readAt: 1000 },
          },
        ],
        requests: cursor.requests + 1,
        phase: "closing",
      },
      [tenant],
    ),
  ).toThrow("incomplete badged empty model");
});

test("URG IIS reserves the last chunk before its one-day run deadline", async () => {
  const initial = UrgiisCursor.initial([tenant]);
  const cursor = UrgiisCursor.checkpoint(
    { ...initial, startedAt: 1000, asOf: 1000 },
    [tenant],
  );
  const result = await Effect.runPromise(
    streamUrgiisInventory({
      tenants: [tenant],
      startCursor: cursor,
      now: 1000 + 24 * 3600_000 - 8 * 60_000,
      readPage: () =>
        Effect.die("A run past its deadline must not make requests"),
      onBatch: () => Effect.die("A run past its deadline must not publish"),
    }),
  );
  expect(result.status).toBe("failed");
  expect(result.pagesProcessed).toBe(0);
  expect(result.errors.join(" ")).toContain("one-day deadline");
});

for (const status of [403, 429] as const) {
  test(`URG IIS ends a tenant on HTTP${status} without a Retry-After`, async () => {
    let reads = 0;
    const result = await Effect.runPromise(
      streamUrgiisInventory({
        tenants: [tenant],
        readPage: () => {
          reads++;
          return Effect.fail({
            ...urgiisError("request", `HTTP${status}`),
            kind: "blocked" as const,
            status,
            retryAfterMs: 0,
          });
        },
        onBatch: () => Effect.die("A blocked tenant cannot publish"),
      }),
    );
    expect(result.status).toBe("failed");
    expect(reads).toBe(1);
    expect(result.pagesProcessed).toBe(1);
  });
}

test("URG checkpoint reuse accepts only identical immutable validated evidence", () => {
  const cursor = UrgiisCursor.initial([tenant]);
  expect(Object.isFrozen(cursor)).toBe(true);
  expect(UrgiisCursor.parse(cursor, [tenant])).toBe(cursor);
  const entry = UrgiisEntrySchema.parse({
    kind: "model",
    url: tenant.origin + model.path,
    bytes: 1,
    records: iisCards(page, tenant).records,
    freshness: { kind: "read", readAt: 0 },
  });
  expect(UrgiisEntrySchema.parse(entry)).toBe(entry);
  expect(Object.isFrozen(entry)).toBe(true);
  if (entry.kind !== "model") throw new Error("Expected model entry");
  expect(Object.isFrozen(entry.records[0]?.vins)).toBe(true);
  const changed: unknown = {
    ...entry,
    records: [{ ...entry.records[0], vins: [123] }],
  };
  expect(() => UrgiisEntrySchema.parse(changed)).toThrow();
  expect(() =>
    UrgiisCursor.parse({ ...cursor, requests: 1 }, [tenant]),
  ).toThrow("checksum changed");
  expect(() =>
    UrgiisCursor.parse(cursor, [{ ...tenant, ownerClaims: ["Changed owner"] }]),
  ).toThrow("qualification changed");
});

test("URG fingerprint preserves existing Unicode checkpoint checksums", () => {
  expect(urgiisFingerprint({ name: "A😀Z", value: 12 })).toBe("c32354ba");
});

test("URG entry receipts preserve legacy cursors and bind changed donor evidence", async () => {
  let cursor = UrgiisCursor.initial([tenant]);
  let reads = 0;
  while (reads < 5) {
    const result = await Effect.runPromise(
      streamUrgiisInventory({
        tenants: [tenant],
        startCursor: cursor,
        maxPages: 1,
        readPage: () => Effect.succeed(responses[reads++] ?? ""),
        onBatch: () => Effect.die("Unclosed census emitted"),
      }),
    );
    cursor = result.cursor;
  }
  if (cursor.phase === "complete") throw new Error("Expected working cursor");
  const { checksum, ...state } = cursor;
  expect(checksum).toStartWith("e1-");
  const legacy = {
    ...state,
    checksum: urgiisFingerprint({ ...state, statePath: undefined }),
  };
  expect(UrgiisCursor.fromWire(JSON.stringify(legacy), [tenant])).toEqual(
    cursor,
  );
  const changed = {
    ...cursor,
    entries: cursor.entries.map((entry) =>
      entry.kind === "model"
        ? {
            ...entry,
            records: entry.records.map((record) => ({
              ...record,
              vins: ["1HGCM82633A004352"],
            })),
          }
        : entry,
    ),
  };
  expect(() => UrgiisCursor.parse(changed, [tenant])).toThrow(
    "checksum changed",
  );
  const withTitle = (repetitions: number) => ({
    ...cursor,
    entries: cursor.entries.map((entry) =>
      entry.kind === "model"
        ? {
            ...entry,
            records: entry.records.map((record) => ({
              ...record,
              titles: ["\n😀".repeat(repetitions)],
            })),
          }
        : entry,
    ),
  });
  const below = UrgiisCursor.checkpoint(
    withTitle(Math.floor((URGIIS_MAX_CURSOR_BYTES - 100_000) / 6)),
    [tenant],
  );
  expect(
    Buffer.byteLength(UrgiisCursor.serialize(below, [tenant])),
  ).toBeLessThan(URGIIS_MAX_CURSOR_BYTES);
  expect(() =>
    UrgiisCursor.checkpoint(withTitle(Math.ceil(URGIIS_MAX_CURSOR_BYTES / 6)), [
      tenant,
    ]),
  ).toThrow("exceeds 16 MiB");
});

test("cold census checkpoints can resume after 40 hours but stop before three days", async () => {
  const initial = UrgiisCursor.initial([tenant]);
  const cold = UrgiisCursor.fromWire(
    UrgiisCursor.serialize(
      UrgiisCursor.checkpoint(
        { ...initial, startedAt: 1000, asOf: 1000, runKind: "cold" },
        [tenant],
      ),
      [tenant],
    ),
    [tenant],
  );
  const resumed = await Effect.runPromise(
    streamUrgiisInventory({
      tenants: [tenant],
      startCursor: cold,
      now: 1000 + 40 * 3600_000,
      maxPages: 1,
      readPage: () => Effect.succeed(responses[0] ?? ""),
      onBatch: () => Effect.die("An opening owner response must not publish"),
    }),
  );
  expect(resumed.status).toBe("paused");
  expect(resumed.pagesProcessed).toBe(1);
  expect(resumed.cursor.startedAt).toBe(1000);
  const stopped = await Effect.runPromise(
    streamUrgiisInventory({
      tenants: [tenant],
      startCursor: cold,
      now: 1000 + 72 * 3600_000 - 8 * 60_000,
      readPage: () => Effect.die("Expired cold census must not make requests"),
      onBatch: () => Effect.die("Expired cold census must not publish"),
    }),
  );
  expect(stopped.status).toBe("failed");
  expect(stopped.pagesProcessed).toBe(0);
  expect(stopped.errors.join(" ")).toContain("three-day cold census deadline");
});

test("a cold census completes distinct tenants across 40 hours with one fixed clock", async () => {
  const other = {
    ...tenant,
    code: "other",
    yard: { ...tenant.yard, code: "other" },
  };
  const tenants = [tenant, other];
  let cursor = UrgiisCursor.initial(tenants);
  let censusState: unknown;
  let reads = 0;
  let batches = 0;
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamUrgiisInventory({
        tenants,
        startCursor: cursor,
        censusState,
        now: 1000 + (cursor.completed.length ? 40 * 3600_000 : 0),
        maxPages: 1,
        readPage: () =>
          Effect.succeed(responses[reads++ % responses.length] ?? ""),
        onBatch: () =>
          Effect.sync(() => {
            batches++;
          }),
      }),
    );
    expect(result.status).not.toBe("failed");
    expect(result.cursor.runKind).toBe("cold");
    expect(result.cursor.startedAt).toBe(1000);
    censusState = result.checkpointState ?? censusState;
    cursor = UrgiisCursor.fromWire(
      UrgiisCursor.serialize(result.cursor, tenants),
      tenants,
    );
  }
  expect(reads).toBe(responses.length * 2);
  expect(batches).toBe(2);
  expect(cursor.completed).toEqual([
    { code: tenant.code, accepted: 1 },
    { code: other.code, accepted: 1 },
  ]);
});

test("cold checkpoints reject carried model evidence even inside the extended deadline", async () => {
  let cursor = UrgiisCursor.initial([tenant]);
  let reads = 0;
  while (cursor.phase === "opening") {
    const result = await Effect.runPromise(
      streamUrgiisInventory({
        tenants: [tenant],
        startCursor: cursor,
        now: 1000,
        maxPages: 1,
        readPage: () => Effect.succeed(responses[reads++] ?? ""),
        onBatch: () => Effect.die("The opening graph must not publish"),
      }),
    );
    cursor = result.cursor;
  }
  if (cursor.phase !== "closing")
    throw new Error("Expected closing model frontier");
  expect(() =>
    UrgiisCursor.checkpoint(
      {
        ...cursor,
        entries: cursor.entries.map((e) =>
          e.kind === "model"
            ? {
                ...e,
                bytes: 0,
                freshness: { ...e.freshness, kind: "carried" },
              }
            : e,
        ),
      },
      [tenant],
    ),
  ).toThrow("cold census cannot carry prior model evidence");
});

test.each([0, 4, 5, "photo"] as const)(
  "supplier mismatch at request %s blocks only that tenant and resumes healthy tenants",
  async (mismatchAt) => {
    const other = {
      ...tenant,
      code: "healthy",
      yard: { ...tenant.yard, code: "healthy" },
    };
    const tenants = [tenant, other];
    let cursor = UrgiisCursor.initial(tenants);
    let reads = 0;
    let healthyReads = 0;
    let state: unknown;
    const vehicles: string[] = [];
    const warnings: string[] = [];
    let chunks = 0;
    while (cursor.phase !== "complete") {
      if (++chunks > 20)
        throw new Error("Tenant isolation did not reach terminal evidence");
      const result = await Effect.runPromise(
        streamUrgiisInventory({
          tenants,
          startCursor: cursor,
          maxPages: 1,
          censusState: state,
          readPage: (_url, current) => {
            const index =
              current.code === tenant.code ? reads++ : healthyReads++;
            const raw = responses[index] ?? "";
            return Effect.succeed(
              current.code === tenant.code &&
                mismatchAt === "photo" &&
                index === 4
                ? raw.replace("cloudfront.net/aa01/", "cloudfront.net/zz99/")
                : current.code === tenant.code && index === mismatchAt
                  ? raw.replace("var urgid = 'AA01'", "var urgid = 'ZZ99'")
                  : raw,
            );
          },
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles.push(...batch.map((v) => v.locationCode));
            }),
        }),
      );
      if (result.checkpointState) state = result.checkpointState;
      warnings.push(...result.warnings);
      cursor = UrgiisCursor.fromWire(
        UrgiisCursor.serialize(result.cursor, tenants),
        tenants,
      );
    }
    expect(cursor.completed).toEqual([
      {
        code: tenant.code,
        blocked: expect.stringContaining(
          mismatchAt === "photo"
            ? "unexpected supplier photo zz99"
            : "supplier identity changed",
        ),
      },
      { code: other.code, accepted: 1 },
    ]);
    expect(vehicles).toEqual([other.code]);
    expect(warnings.join(" ")).toContain(
      mismatchAt === "photo"
        ? "yard attribution must be requalified"
        : "expected AA01",
    );
    expect(reads).toBe(mismatchAt === "photo" ? 8 : mismatchAt + 1);
  },
);

test("URG leaves a browser tenant's pages for a chunk that opened its browser session", async () => {
  const withoutSession = await Effect.runPromise(
    streamUrgiisInventory({
      tenants: [tenant],
      browserTenants: { codes: new Set([tenant.code]), session: null },
      readPage: () =>
        Effect.die("A browser tenant must not be read over direct HTTP"),
      onBatch: () => Effect.die("No page was read"),
    }),
  );
  expect(withoutSession.status).toBe("paused");
  expect(withoutSession.pagesProcessed).toBe(0);
});

const browserChunk = (
  windowEndsAt: number,
  readPage: (url: string, index: number) => Effect.Effect<string>,
  startCursor?: unknown,
) => {
  const read: string[] = [];
  let batches = 0;
  return Effect.runPromise(
    streamUrgiisInventory({
      tenants: [tenant],
      startCursor,
      maxPages: 3,
      browserTenants: {
        codes: new Set([tenant.code]),
        session: { code: tenant.code, windowEndsAt },
      },
      readPage: (url) => {
        read.push(url);
        return readPage(url, read.length - 1);
      },
      onBatch: () =>
        Effect.sync(() => {
          batches++;
        }),
    }).pipe(Effect.provide(TestContext.TestContext)),
  ).then((result) => ({ result, read, batches }));
};
const answer = (index: number) => Effect.succeed(responses[index] ?? "");

test("URG reads a browser tenant's whole census in one session instead of three pages per chunk", async () => {
  const { result, read, batches } = await browserChunk(
    8 * 60_000,
    (_url, index) => answer(index),
  );
  // Owner, makes, arrivals, menu, model, then the closing owner, makes and
  // menu: the plain-HTTP chunk budget of three would need three sessions.
  expect(read).toHaveLength(8);
  expect(result.pagesProcessed).toBe(8);
  expect(batches).toBe(1);
  expect(result.count).toBe(1);
});

test("URG starts no browser page in the session window's last minute", async () => {
  // Each page takes 20 seconds; the window closes at 160 seconds, so pages
  // start at 0, 20, 40, 60 and 80 seconds but not at 100.
  const { result, read } = await browserChunk(160_000, (_url, index) =>
    TestClock.adjust("20 seconds").pipe(Effect.zipRight(answer(index))),
  );
  expect(read).toHaveLength(5);
  expect(result.status).toBe("paused");
  expect(result.pagesProcessed).toBe(5);
  const resumed = await browserChunk(
    8 * 60_000,
    (_url, index) => answer(index + 5),
    result.cursor,
  );
  expect(resumed.read).toHaveLength(3);
  expect(resumed.batches).toBe(1);
});

test("URG abandons a later browser page still loading as the window closes and keeps its checkpoint", async () => {
  const { result, read } = await browserChunk(160_000, (_url, index) =>
    index < 2
      ? TestClock.adjust("20 seconds").pipe(Effect.zipRight(answer(index)))
      : TestClock.adjust("3 minutes").pipe(Effect.zipRight(Effect.never)),
  );
  expect(read).toHaveLength(3);
  expect(result.status).toBe("paused");
  expect(result.pagesProcessed).toBe(2);
  expect(result.warnings.join(" ")).toContain("abandoned unrecorded");
  // The next chunk starts with the abandoned page.
  const resumed = await browserChunk(
    8 * 60_000,
    (_url, index) => answer(index + 2),
    result.cursor,
  );
  expect(resumed.read[0]).toBe(read[2]);
  expect(resumed.batches).toBe(1);
});

test("URG always reads a browser chunk's first page, even late in its window", async () => {
  const { result, read } = await browserChunk(10_000, (_url, index) =>
    TestClock.adjust("20 seconds").pipe(Effect.zipRight(answer(index))),
  );
  expect(read).toHaveLength(1);
  expect(result.pagesProcessed).toBe(1);
});

test("URG names the tenant a chunk starts on so production opens its browser session", () => {
  const second: UrgiisTenant = { ...tenant, code: "second" };
  expect(urgiisChunkTenant(undefined, [tenant, second])?.code).toBe(
    tenant.code,
  );
  expect(
    urgiisChunkTenant(UrgiisCursor.initial([tenant, second]), [tenant, second])
      ?.code,
  ).toBe(tenant.code);
  expect(urgiisChunkTenant(UrgiisCursor.initial([]), [])).toBeNull();
  expect(urgiisChunkTenant({ checksum: "tampered" }, [tenant])).toBeNull();
});

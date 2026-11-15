import { expect, test } from "bun:test";
import { Effect } from "effect";
import { UrgiisCursor } from "./urgiis-cursor";
import { streamUrgiisInventory } from "./urgiis-connector";
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
test("URG IIS fails closed on directory drift, source mixing, caps and corrupt checkpoints", async () => {
  for (const [changedIndex, changed] of [
    [6, makes.replace(">1<", ">2<")],
    [4, document(`<div class="card-deck">${card().repeat(500)}</div>`)],
  ] as const) {
    let reads = 0;
    let batches = 0;
    let cursor = UrgiisCursor.initial([tenant]);
    let failure: unknown;
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
        cursor = result.cursor;
      }
    } catch (cause) {
      failure = cause;
    }
    expect(failure).toBeDefined();
    expect(batches).toBe(0);
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

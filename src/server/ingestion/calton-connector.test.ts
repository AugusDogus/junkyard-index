import { expect, test } from "bun:test";
import { Effect } from "effect";
import { streamCaltonInventory } from "./calton-connector";
import {
  CALTON_MAKES,
  CALTON_ROOT,
  CaltonContract,
  CaltonError,
  type CaltonContract as Contract,
} from "./calton-contract";
import { CaltonCursor } from "./calton-cursor";
import { caltonClass, caltonElements, caltonRegion } from "./calton-html";
import { caltonAdvance, caltonNextUrl } from "./calton-traversal";
import {
  CALTON_EMPTY_REGION,
  CALTON_TLX_FIXTURE,
  caltonFixtureDocument,
} from "./calton-test-fixtures";

const contract: Contract = {
  location: {
    code: "MM28",
    name: "Calton Auto Parts Recyclers",
    city: "Elkridge",
    lat: 39.185,
    lng: -76.76,
  },
  minimumUniqueInventory: 1,
};
const makeUrl = "https://caltonautoparts.com/parts/ACURA",
  modelUrl = makeUrl + "/TLX";
function menu(
  path: string,
  label: string,
  count: number,
  source: string,
  models = false,
) {
  return caltonFixtureDocument(
    `<div ${models ? 'id="menumodellist"' : 'class="iisMakesMenu"'}><a href="https://caltonautoparts.com${path}"><span class="aps-make-link__label">${label}</span><span class="aps-make-link__count">${count}</span></a></div>`,
    source,
  );
}
function harness() {
  const requests: string[] = [],
    batches: string[][] = [];
  const firstCard = caltonElements(
    caltonRegion(CALTON_TLX_FIXTURE, (tag) => caltonClass(tag, "aps-la-grid")),
    "div",
    (tag) => caltonClass(tag, "aps-la-card-premium"),
  )[0];
  if (!firstCard) throw new Error("Missing saved TLX arrival card");
  const arrivals = caltonFixtureDocument(
    `<div class="aps-la-grid">${firstCard.tag}${firstCard.body}</div></div>`,
    "/",
  );
  const documents = new Map([
    [CALTON_ROOT, arrivals],
    [CALTON_MAKES, menu("/parts/ACURA", "ACURA", 8, "/parts/")],
    [makeUrl, menu("/parts/ACURA/TLX", "TLX", 8, "/parts/ACURA", true)],
    [modelUrl, CALTON_TLX_FIXTURE],
  ]);
  const options = {
    contract,
    previousUniqueInventory: null,
    readPage: (url: string) => {
      requests.push(url);
      const raw = documents.get(url);
      return raw === undefined
        ? Effect.fail(
            CaltonError.create("saved reader", "No saved document for " + url),
          )
        : Effect.succeed(raw);
    },
    onBatch: (vehicles: readonly { vin: string }[]) =>
      Effect.sync(() => {
        batches.push(vehicles.map((vehicle) => vehicle.vin));
      }),
  };
  return { options, requests, batches, documents };
}
test("Calton contract requires an explicit qualified minimum and valid location", () => {
  expect(CaltonContract.parse(contract).ok).toBe(true);
  expect(CaltonContract.parse({ location: contract.location }).ok).toBe(false);
  expect(
    CaltonContract.parse({
      ...contract,
      location: { ...contract.location, lat: 200 },
    }).ok,
  ).toBe(false);
  expect(
    CaltonCursor.initial({
      ...contract,
      location: { ...contract.location, lat: 200 },
    }).ok,
  ).toBe(false);
});
test("invalid chunk and previous-inventory budgets fail before reading", async () => {
  for (const invalid of [
    { maxPages: 0 },
    { maxPages: 9 },
    { maxPages: Number.NaN },
    { previousUniqueInventory: -1 },
  ]) {
    const run = harness();
    const result = await Effect.runPromise(
      Effect.either(streamCaltonInventory({ ...run.options, ...invalid })),
    );
    expect(result._tag).toBe("Left");
    expect(run.requests).toEqual([]);
    expect(run.batches).toEqual([]);
  }
});
test("Calton serializes and resumes the exact graph, emitting only after terminal validation", async () => {
  const run = harness();
  const first = await Effect.runPromise(
    streamCaltonInventory({ ...run.options, maxPages: 3 }),
  );
  expect(first.status).toBe("paused");
  expect(first.cursor.phase).toBe("models");
  expect(first.count).toBe(0);
  expect(run.batches).toEqual([]);
  const wire = CaltonCursor.serialize(first.cursor, contract);
  if (!wire.ok) throw new Error(wire.error.message);
  const last = await Effect.runPromise(
    streamCaltonInventory({
      ...run.options,
      startCursor: wire.value,
      maxPages: 1,
    }),
  );
  expect(last.status).toBe("complete");
  expect(last.cursor.phase).toBe("complete");
  expect(last.count).toBe(8);
  expect(run.batches).toHaveLength(1);
  expect(run.requests).toEqual([CALTON_ROOT, CALTON_MAKES, makeUrl, modelUrl]);
  const again = await Effect.runPromise(
    streamCaltonInventory({ ...run.options, startCursor: last.cursor }),
  );
  expect(again.pagesProcessed).toBe(0);
  expect(run.batches).toHaveLength(1);
});
test("changed contracts, parents and serialized evidence cannot resume", async () => {
  const run = harness();
  const paused = await Effect.runPromise(
    streamCaltonInventory({ ...run.options, maxPages: 3 }),
  );
  expect(
    CaltonCursor.parse(paused.cursor, {
      ...contract,
      location: { ...contract.location, code: "OTHER" },
    }).ok,
  ).toBe(false);
  expect(
    CaltonCursor.parse({ ...paused.cursor, source: "foreign" }, contract).ok,
  ).toBe(false);
  if (paused.cursor.phase !== "models")
    throw new Error("Expected model prefix");
  const menus = paused.cursor.menus.map((menu) => ({
    ...menu,
    make: { ...menu.make, label: "CHANGED" },
  }));
  expect(
    CaltonCursor.checkpoint({ ...paused.cursor, menus }, contract).ok,
  ).toBe(false);
  expect(CaltonCursor.fromWire("{", contract).ok).toBe(false);
});
test("checkpoints reject altered accounting, impossible ready prefixes and moved record evidence", async () => {
  const run = harness();
  const prefix = await Effect.runPromise(
    streamCaltonInventory({ ...run.options, maxPages: 3 }),
  );
  if (prefix.cursor.phase !== "models")
    throw new Error("Expected model prefix");
  expect(
    CaltonCursor.checkpoint(
      { ...prefix.cursor, requests: prefix.cursor.requests + 1 },
      contract,
    ).ok,
  ).toBe(false);
  expect(
    CaltonCursor.checkpoint(
      { ...prefix.cursor, bytes: prefix.cursor.bytes + 1 },
      contract,
    ).ok,
  ).toBe(false);
  expect(
    CaltonCursor.checkpoint({ ...prefix.cursor, phase: "ready" }, contract).ok,
  ).toBe(false);
  const advanced = caltonAdvance(prefix.cursor, CALTON_TLX_FIXTURE, contract);
  if (!advanced.ok) throw new Error(advanced.error.message);
  const ready = advanced.value;
  if (ready.phase !== "ready") throw new Error("Expected complete saved graph");
  expect(CaltonCursor.parse(ready, contract).ok).toBe(true);
  expect(
    CaltonCursor.parse({ ...ready, bytes: ready.bytes + 1 }, contract).ok,
  ).toBe(false);
  for (const mutation of [
    "source",
    "parent",
    "ordinal",
    "count",
    "empty",
  ] as const) {
    const pages = ready.pages.map((page) => ({
      ...page,
      records: page.records.map((record) => ({
        ...record,
        ...(mutation === "source" ? { sourceUrl: CALTON_ROOT } : {}),
        ...(mutation === "parent"
          ? { context: { kind: "arrivals" as const, sourceUrl: CALTON_ROOT } }
          : {}),
        ...(mutation === "ordinal" ? { ordinal: record.ordinal + 1 } : {}),
      })),
      ...(mutation === "count"
        ? {
            countCheck: {
              kind: "matches" as const,
              advertised: 9,
              observed: 8,
            },
          }
        : {}),
      ...(mutation === "empty"
        ? {
            nativeEmptyResult:
              "No Results.. Try Browsing Our Parts Or Search Again",
          }
        : {}),
    }));
    expect(CaltonCursor.checkpoint({ ...ready, pages }, contract).ok).toBe(
      false,
    );
  }
  expect(run.batches).toEqual([]);
});
/** A second ACURA model of `stocks.length` donors, so a one-card native empty
 * model stays inside the badge coverage floor as it does at live scale (one
 * of 12,857 cards). */
function filler(run: ReturnType<typeof harness>, stocks: readonly string[]) {
  const path = "/parts/ACURA/FILLER";
  const url = "https://caltonautoparts.com" + path;
  const cards = stocks.map(
    (stock, index) =>
      `<div id="${stock}" class="aps-la-card-premium"><a href="${url}/${stock}/2015" class="aps-la-card-link-premium"><div class="aps-la-content-premium aps-la-car-details"><h3 class="aps-la-title-premium">ACURA FILLER</h3><p class="aps-la-subtitle-premium aps-la-subtitle-premium--vin">VIN: 19UUB1F3${String(index).padStart(9, "0")}</p><div class="aps-la-right-val-premium"><span class="aps-la-field-label">Year</span> 2015</div><div class="aps-la-stat-premium"><div class="aps-la-stat-label">Stock</div><div class="aps-la-stat-value">${stock}</div></div></div></a></div>`,
  );
  run.documents.set(
    makeUrl,
    menu("/parts/ACURA/TLX", "TLX", 8, "/parts/ACURA", true).replace(
      "</a></div>",
      `</a><a href="${url}"><span class="aps-make-link__label">FILLER</span><span class="aps-make-link__count">${stocks.length}</span></a></div>`,
    ),
  );
  run.documents.set(
    url,
    caltonFixtureDocument(
      `<div id="iiscont"><div class="aps-la-grid">${cards.join("")}</div></div>`,
      path,
    ),
  );
}
test("the published dot-ending explicit empty model remains a required observation", async () => {
  const run = harness();
  const emptyMakeUrl = "https://caltonautoparts.com/parts/CHEVROLET";
  const emptyPath = "/parts/CHEVROLET/CHEVROLET_PASS.";
  const emptyUrl = "https://caltonautoparts.com" + emptyPath;
  const donors = Array.from({ length: 12 }, (_, i) => "F" + i);
  filler(run, donors);
  run.documents.set(
    CALTON_MAKES,
    menu("/parts/ACURA", "ACURA", 8, "/parts/").replace(
      "</a></div>",
      '</a><a href="https://caltonautoparts.com/parts/CHEVROLET"><span class="aps-make-link__label">CHEVROLET</span><span class="aps-make-link__count">1</span></a></div>',
    ),
  );
  run.documents.set(
    emptyMakeUrl,
    menu(emptyPath, "CHEVROLET PASS. 1", 1, "/parts/CHEVROLET", true),
  );
  run.documents.set(
    emptyUrl,
    caltonFixtureDocument(CALTON_EMPTY_REGION, emptyPath),
  );
  const prefix = await Effect.runPromise(
    streamCaltonInventory({ ...run.options, maxPages: 6 }),
  );
  expect(prefix.status).toBe("paused");
  expect(run.batches).toEqual([]);
  expect(caltonNextUrl(prefix.cursor)).toEqual({ ok: true, value: emptyUrl });
  const ready = caltonAdvance(
    prefix.cursor,
    caltonFixtureDocument(CALTON_EMPTY_REGION, emptyPath),
    contract,
  );
  if (!ready.ok) throw new Error(ready.error.message);
  if (ready.value.phase !== "ready") throw new Error("Expected ready graph");
  expect(ready.value.pages[2]).toMatchObject({
    sourceUrl: emptyUrl,
    records: [],
    nativeEmptyResult: "No Results.. Try Browsing Our Parts Or Search Again",
    countCheck: { kind: "mismatch", advertised: 1, observed: 0 },
  });
  const complete = await Effect.runPromise(
    streamCaltonInventory({ ...run.options, startCursor: prefix.cursor }),
  );
  expect(complete.status).toBe("complete");
  expect(complete.count).toBe(8 + donors.length);
  expect(run.requests.at(-1)).toBe(emptyUrl);
  expect(run.batches).toHaveLength(1);
});
test("unread controls, missing documents and failed source validation never emit", async () => {
  for (const variant of [
    "continuation",
    "outside-continuation",
    "outside-menu-continuation",
    "missing",
    "foreign",
    "minimum",
  ] as const) {
    const run = harness();
    if (variant === "continuation")
      run.documents.set(
        modelUrl,
        CALTON_TLX_FIXTURE.replace(
          '<div class="aps-la-grid">',
          '<a rel="next" href="?page=2">Next</a><div class="aps-la-grid">',
        ),
      );
    if (variant === "missing") run.documents.delete(modelUrl);
    if (variant === "outside-continuation")
      run.documents.set(
        modelUrl,
        CALTON_TLX_FIXTURE.replace(
          "<footer>",
          '<a rel="next" href="?page=2">Next</a><footer>',
        ),
      );
    if (variant === "outside-menu-continuation")
      run.documents.set(
        makeUrl,
        menu("/parts/ACURA/TLX", "TLX", 8, "/parts/ACURA", true).replace(
          "<footer>",
          '<a rel="next" href="?page=2">Next</a><footer>',
        ),
      );
    if (variant === "foreign")
      run.documents.set(
        modelUrl,
        CALTON_TLX_FIXTURE.replace("'MM28'", "'OTHER'"),
      );
    const result = await Effect.runPromise(
      Effect.either(
        streamCaltonInventory({
          ...run.options,
          contract:
            variant === "minimum"
              ? { ...contract, minimumUniqueInventory: 100 }
              : contract,
        }),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(run.batches).toEqual([]);
  }
});
test("native count differences are diagnostic and a failed batch cannot mark complete", async () => {
  // Rows one above the badge, as on 22 live models, stay diagnostic.
  const run = harness();
  run.documents.set(
    makeUrl,
    menu("/parts/ACURA/TLX", "TLX", 7, "/parts/ACURA", true),
  );
  const result = await Effect.runPromise(
    streamCaltonInventory({ ...run.options, maxPages: 4 }),
  );
  expect(result.status).toBe("complete");
  expect(result.count).toBe(8);
  // One card short of nine is 89% of the badges, below the coverage floor.
  const short = harness();
  short.documents.set(
    makeUrl,
    menu("/parts/ACURA/TLX", "TLX", 9, "/parts/ACURA", true),
  );
  const shortfall = await Effect.runPromise(
    Effect.either(streamCaltonInventory({ ...short.options, maxPages: 4 })),
  );
  if (shortfall._tag !== "Left") throw new Error("Expected a coverage failure");
  expect(shortfall.left.message).toContain(
    "8 of 9 cards promised by today's model counts",
  );
  expect(short.batches).toEqual([]);
  const failed = harness();
  const prefix = await Effect.runPromise(
    streamCaltonInventory({ ...failed.options, maxPages: 3 }),
  );
  const error = await Effect.runPromise(
    Effect.either(
      streamCaltonInventory({
        ...failed.options,
        startCursor: prefix.cursor,
        onBatch: () => Effect.fail("batch failed"),
      }),
    ),
  );
  expect(error._tag).toBe("Left");
  expect(prefix.cursor.phase).toBe("models");
  expect(failed.batches).toEqual([]);
});

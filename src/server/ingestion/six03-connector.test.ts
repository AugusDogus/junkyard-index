import { afterEach, expect, test } from "bun:test";
import { Effect, TestClock, TestContext } from "effect";
import { soakSix03Inventory } from "../../../scripts/soak-six03";
import { streamSix03InventoryWithRequestGate } from "./six03-connector";
import {
  Six03Cursor,
  SIX03_MAX_CURSOR_BYTES,
  SIX03_MAX_REQUESTS,
  type Six03Progress,
} from "./six03-cursor";
import {
  parseSix03Catalog,
  parseSix03Contact,
  parseSix03Detail,
  parseSix03RestPage,
} from "./six03-parser";
import {
  six03FixtureDetail,
  six03IndependentOracle,
  six03NativeFixtures,
  six03RestFixtures,
} from "./six03-test-fixtures";
import type { Six03CanonicalVehicle } from "./six03-transform";
import {
  SIX03_CATALOG,
  SIX03_CONTACT,
  SIX03_ORIGIN,
  six03RestPageUrl,
} from "./six03-yard-metadata";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const fixtures = six03NativeFixtures();
const rest = six03RestFixtures();
type Served = { body: string; headers: Record<string, string> };
const documents = new Map<string, Served>([
  [
    SIX03_CATALOG,
    { body: fixtures.catalog, headers: { "content-type": "text/html" } },
  ],
  [
    SIX03_CONTACT,
    { body: fixtures.contact, headers: { "content-type": "text/html" } },
  ],
  ...rest.pages.map((page): [string, Served] => [
    page.url,
    {
      body: page.body,
      headers: {
        "content-type": page.contentType,
        "x-wp-total": String(page.total),
        "x-wp-totalpages": String(page.totalPages),
      },
    },
  ]),
]);

function serve(
  transform: (url: string, served: Served, ordinal: number) => Served = (
    _url,
    served,
  ) => served,
) {
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const served = documents.get(url);
      if (!served) throw new Error("Unexpected native GET " + url);
      if (init?.method !== "GET" || init.redirect !== "manual")
        throw new Error("Unexpected source request contract");
      requests.push(url);
      const { body, headers } = transform(url, served, requests.length);
      return new Response(body, { headers });
    },
    { preconnect: original.preconnect },
  );
  return requests;
}

const restPages = rest.pages.map((_, index) => six03RestPageUrl(index + 1));

test("603 reads the whole saved REST census in one chunk and matches the independent full-field oracle", async () => {
  const requests = serve();
  const emitted: Six03CanonicalVehicle[] = [];
  let yards = 0;
  let chunks = 0;
  let largestCursor = 0;
  const summary = await soakSix03Inventory(async (cursor, maxPages) => {
    const result = await Effect.runPromise(
      streamSix03InventoryWithRequestGate(
        {
          startCursor: Six03Cursor.parse(Six03Cursor.serialize(cursor)),
          maxPages,
          onBatch: (vehicles) =>
            Effect.sync(() => {
              expect(requests).toHaveLength(17);
              emitted.push(...vehicles);
            }),
          onYards: (values) =>
            Effect.sync(() => {
              yards += values.length;
            }),
        },
        gate,
      ),
    );
    chunks++;
    largestCursor = Math.max(
      largestCursor,
      Buffer.byteLength(Six03Cursor.serialize(result.cursor)),
    );
    return result;
  });
  expect(summary.status).toBe("complete");
  expect(chunks).toBe(1);
  // Contact, catalog, 11 REST pages, then closing contact, catalog and the
  // first and last REST pages: 17 GETs instead of 1,029 donor pages.
  expect(requests).toEqual([
    SIX03_CONTACT,
    SIX03_CATALOG,
    ...restPages,
    SIX03_CONTACT,
    SIX03_CATALOG,
    six03RestPageUrl(1),
    six03RestPageUrl(11),
  ]);
  expect(summary.pagesProcessed).toBe(17);
  expect(summary.count).toBe(973);
  expect(summary.accounting).toEqual({
    recordsProcessed: 1033,
    recordsExcluded: 0,
    recordsRejected: 60,
    duplicateVehicles: 0,
  });
  expect(summary.observedVins).toHaveLength(26);
  expect(yards).toBe(1);
  expect(largestCursor).toBeLessThan(SIX03_MAX_CURSOR_BYTES);
  const oracle = six03IndependentOracle();
  const sortByVin = (
    a: { vin?: string | number | null },
    b: { vin?: string | number | null },
  ) => String(a.vin).localeCompare(String(b.vin));
  // The oracle came from donor pages plus the catalog's ten excerpts, which
  // carry no photo. REST gives those donors their full article, so the only
  // difference is the article's main photo on the excerpt donors that have one.
  const catalog = parseSix03Catalog(fixtures.catalog);
  const excerpts = new Set(
    catalog.embedded.map((record) => SIX03_ORIGIN + record.path),
  );
  const changed = emitted.filter(
    (vehicle) =>
      oracle.find((expected) => expected.vin === vehicle.vin)?.imageUrl !==
      vehicle.imageUrl,
  );
  expect(changed.map((vehicle) => vehicle.detailsUrl).sort()).toEqual([
    SIX03_ORIGIN + "/parts-vehicles/2004-toyota-matrix-gray/",
    SIX03_ORIGIN + "/parts-vehicles/2007-jeep-commander-black/",
    SIX03_ORIGIN + "/parts-vehicles/2009-ford-flex/",
  ]);
  expect(
    changed.every((vehicle) => excerpts.has(vehicle.detailsUrl ?? "")),
  ).toBe(true);
  const jeep = catalog.posts.find(
    ([path]) => path === "/parts-vehicles/2007-jeep-commander-black/",
  );
  if (!jeep) throw new Error("Missing the Jeep excerpt donor");
  // The Jeep's saved donor page shows the same photo its REST article does.
  expect(
    emitted.find((vehicle) => vehicle.detailsUrl === SIX03_ORIGIN + jeep[0])
      ?.imageUrl,
  ).toBe(parseSix03Detail(six03FixtureDetail(jeep[0]), jeep).image);
  const withArticlePhotos = oracle.map((expected) => ({
    ...expected,
    imageUrl:
      changed.find((vehicle) => vehicle.vin === expected.vin)?.imageUrl ??
      expected.imageUrl,
  }));
  expect([...emitted].sort(sortByVin)).toEqual(
    withArticlePhotos.sort(sortByVin),
  );
}, 120_000);

test("603 refuses invalid GET budgets and checkpoint versions before issuing HTTP", async () => {
  const requests = serve();
  for (const maxPages of [0, SIX03_MAX_REQUESTS + 1, -1, 1.5, Number.NaN]) {
    await expect(
      Effect.runPromise(
        streamSix03InventoryWithRequestGate(
          { maxPages, onBatch: () => Effect.void },
          gate,
        ),
      ),
    ).rejects.toThrow(`1-${SIX03_MAX_REQUESTS}`);
  }
  expect(() =>
    Six03Cursor.parse(JSON.stringify({ ...Six03Cursor.initial, version: 1 })),
  ).toThrow();
  expect(requests).toHaveLength(0);
});

test("603 pauses at its GET budget mid-census without publishing rows or rejected VIN presence", async () => {
  const requests = serve();
  let batches = 0;
  const result = await Effect.runPromise(
    streamSix03InventoryWithRequestGate(
      {
        maxPages: 5,
        onBatch: () =>
          Effect.sync(() => {
            batches++;
          }),
      },
      gate,
    ),
  );
  expect(requests).toEqual([
    SIX03_CONTACT,
    SIX03_CATALOG,
    ...restPages.slice(0, 3),
  ]);
  expect(result.status).toBe("paused");
  expect(result.count).toBe(0);
  expect(result.observedVins).toEqual([]);
  expect(batches).toBe(0);
  expect(result.cursor.phase).toBe("donors");
  if (result.cursor.phase !== "donors") throw new Error("Expected donors");
  expect(result.cursor.details).toHaveLength(300);
});

test("603 stops starting GETs before the chunk deadline and pauses at a checkpoint", async () => {
  const requests = serve();
  // Every GET takes 26 seconds: after six (156 s), fewer than 25 s of the
  // three-minute chunk remain, so the seventh never starts.
  const slow = <A, E, R>(request: Effect.Effect<A, E, R>) =>
    request.pipe(Effect.tap(() => TestClock.adjust("26 seconds")));
  const result = await Effect.runPromise(
    streamSix03InventoryWithRequestGate(
      { onBatch: () => Effect.void },
      slow,
    ).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result.status).toBe("paused");
  expect(result.pagesProcessed).toBe(6);
  expect(requests).toHaveLength(6);
  expect(Six03Cursor.parse(Six03Cursor.serialize(result.cursor))).toEqual(
    result.cursor,
  );
});

let cachedClosing: Six03Progress | undefined;
function closingState(): Six03Progress {
  if (cachedClosing) return cachedClosing;
  const catalog = parseSix03Catalog(fixtures.catalog);
  const pages = rest.pages.map((page, index) =>
    parseSix03RestPage(page.body, index + 1, page, catalog),
  );
  cachedClosing = Six03Cursor.checkpoint({
    ...Six03Cursor.initial,
    phase: "closing",
    contact: parseSix03Contact(fixtures.contact),
    catalog,
    pages: pages.map((page) => page.ids),
    details: pages.flatMap((page) => page.details),
    requests: pages.length + 2,
  });
  return cachedClosing;
}

test("603 changed closing contact, roster or first/last REST donor evidence stops before any callbacks", async () => {
  const seed = closingState();
  const replace =
    (from: string, to: string) =>
    (_url: string, served: Served): Served => ({
      ...served,
      body: served.body.replaceAll(from, to),
    });
  const mutations: [number, (url: string, served: Served) => Served][] = [
    [0, replace("233 Main St", "5 Westville Road")],
    [1, replace('data-year="2000"', 'data-year="2001"')],
    // First page: the Ranger's Unit Data (a rejected donor still counts).
    [2, replace("2000 Ford Ford Ranger", "2000 Ford Ford Explorer")],
    [3, replace("2011 Cadillac CTS<\\/td>", "2011 Cadillac STS<\\/td>")],
  ];
  for (const [closing, transform] of mutations) {
    const requests = serve(transform);
    let callbacks = 0;
    const cursor = Six03Cursor.checkpoint({
      ...seed,
      closing,
      requests: seed.requests + closing,
    });
    await expect(
      Effect.runPromise(
        streamSix03InventoryWithRequestGate(
          {
            startCursor: cursor,
            maxPages: 1,
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
    ).rejects.toThrow();
    expect(requests).toHaveLength(1);
    expect(callbacks).toBe(0);
    expect(Six03Cursor.parse(Six03Cursor.serialize(cursor))).toEqual(cursor);
  }
}, 30_000);

test("603 a roster that shifts between REST page reads stops the census", async () => {
  const pageOne: unknown[] = JSON.parse(rest.pages[0]?.body ?? "[]");
  const pageTwo: unknown[] = JSON.parse(rest.pages[1]?.body ?? "[]");
  // A donor added with a higher id pushes page one's last donor onto page two.
  const shifted = JSON.stringify([pageOne.at(-1), ...pageTwo.slice(0, -1)]);
  const requests = serve((url, served) =>
    url === restPages[1] ? { ...served, body: shifted } : served,
  );
  await expect(
    Effect.runPromise(
      streamSix03InventoryWithRequestGate(
        { onBatch: () => Effect.die("A shifted roster must not publish") },
        gate,
      ),
    ),
  ).rejects.toThrow("descending-id prefix");
  expect(requests).toEqual([
    SIX03_CONTACT,
    SIX03_CATALOG,
    ...restPages.slice(0, 2),
  ]);
});

test("603 refuses a REST census whose size disagrees with the catalog", async () => {
  for (const headers of [
    { "x-wp-total": "1034", "x-wp-totalpages": "11" },
    { "x-wp-total": "1033", "x-wp-totalpages": "12" },
  ]) {
    serve((url, served) =>
      url === restPages[0]
        ? { ...served, headers: { ...served.headers, ...headers } }
        : served,
    );
    await expect(
      Effect.runPromise(
        streamSix03InventoryWithRequestGate(
          { onBatch: () => Effect.die("A changed census must not publish") },
          gate,
        ),
      ),
    ).rejects.toThrow("but the catalog lists 1033");
  }
});

test("603 a completed checkpoint performs no requests or repeated emission", async () => {
  const requests = serve();
  let callbacks = 0;
  const result = await Effect.runPromise(
    streamSix03InventoryWithRequestGate(
      {
        startCursor: { source: "six03", version: 2, phase: "complete" },
        onBatch: () =>
          Effect.sync(() => {
            callbacks++;
          }),
      },
      gate,
    ),
  );
  expect(result.status).toBe("complete");
  expect(result.pagesProcessed).toBe(0);
  expect(result.count).toBe(0);
  expect(callbacks).toBe(0);
  expect(requests).toHaveLength(0);
});

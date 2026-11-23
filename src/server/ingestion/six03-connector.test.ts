import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { soakSix03Inventory } from "../../../scripts/soak-six03";
import {
  isDurableSourceCursorTerminal,
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-source";
import { ModelCensus } from "./model-census";
import { streamSix03InventoryWithRequestGate } from "./six03-connector";
import {
  Six03Cursor,
  SIX03_MAX_CURSOR_BYTES,
  type Six03Progress,
} from "./six03-cursor";
import {
  parseSix03Catalog,
  parseSix03Contact,
  parseSix03Detail,
} from "./six03-parser";
import { six03PendingPosts } from "./six03-snapshot";
import {
  six03FixtureDetail,
  six03IndependentOracle,
  six03NativeFixtures,
} from "./six03-test-fixtures";
import type { Six03CanonicalVehicle } from "./six03-transform";
import {
  SIX03_CATALOG,
  SIX03_CONTACT,
  SIX03_ORIGIN,
} from "./six03-yard-metadata";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const fixtures = six03NativeFixtures();
const documents = new Map(
  fixtures.details.map(([path, html]) => [SIX03_ORIGIN + path, html]),
);
documents.set(SIX03_CATALOG, fixtures.catalog);
documents.set(SIX03_CONTACT, fixtures.contact);

function serve(
  transform: (url: string, html: string, ordinal: number) => string = (
    _url,
    html,
  ) => html,
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
      const html = documents.get(url);
      if (!html) throw new Error("Unexpected native GET " + url);
      if (init?.method !== "GET" || init.redirect !== "manual")
        throw new Error("Unexpected source request contract");
      requests.push(url);
      return new Response(transform(url, html, requests.length), {
        headers: { "content-type": "text/html" },
      });
    },
    { preconnect: original.preconnect },
  );
  return requests;
}

test("603 replays every saved native control through serialized 8-page checkpoints and compares the independent full-field oracle", async () => {
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
              expect(requests.length).toBe(1029);
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
    expect(result.pagesProcessed).toBeLessThanOrEqual(8);
    largestCursor = Math.max(
      largestCursor,
      Buffer.byteLength(Six03Cursor.serialize(result.cursor)),
    );
    if (result.status === "paused") {
      expect(emitted).toHaveLength(0);
      expect(yards).toBe(0);
      expect(result.count).toBe(0);
      expect(result.observedVins).toEqual([]);
      expect(result.accounting.recordsProcessed).toBe(0);
    }
    return result;
  });
  expect(summary.status).toBe("complete");
  expect(chunks).toBe(129);
  expect(requests).toHaveLength(1029);
  expect(summary.pagesProcessed).toBe(1029);
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
  expect([...emitted].sort(sortByVin)).toEqual([...oracle].sort(sortByVin));
  expect(emitted.every((vehicle) => Object.keys(vehicle).length === 25)).toBe(
    true,
  );
  const pending = six03PendingPosts(parseSix03Catalog(fixtures.catalog));
  expect(requests.slice(-4)).toEqual([
    SIX03_CONTACT,
    SIX03_CATALOG,
    SIX03_ORIGIN + pending[0]?.[0],
    SIX03_ORIGIN + pending.at(-1)?.[0],
  ]);
  // Without a previous census the run is cold and publishes a census of
  // every fetched donor for the next run to carry.
  expect(summary.warnings).toContain(
    "603 donor census: Read 1023 of 1023 model pages (cold 1023); carried 0.",
  );
  if (summary.cursor.phase !== "complete" || !summary.cursor.census)
    throw new Error("Expected a terminal 603 census");
  expect(summary.cursor.census.models).toHaveLength(1023);
  const wire = serializeDurableSourceCursor(summary.cursor);
  expect(
    serializeDurableSourceCursor(parseDurableSourceCursor("six03", wire)),
  ).toBe(wire);
  expect(isDurableSourceCursorTerminal("six03", wire)).toBe(true);
  expect(
    isDurableSourceCursorTerminal(
      "six03",
      serializeDurableSourceCursor(closingState()),
    ),
  ).toBe(false);
}, 120_000);

test("603 refuses invalid page budgets and checkpoint versions before issuing HTTP", async () => {
  const requests = serve();
  for (const maxPages of [0, 9, -1, 1.5, Number.NaN]) {
    await expect(
      Effect.runPromise(
        streamSix03InventoryWithRequestGate(
          { maxPages, onBatch: () => Effect.void },
          gate,
        ),
      ),
    ).rejects.toThrow("1-8");
  }
  expect(() =>
    Six03Cursor.parse(JSON.stringify({ ...Six03Cursor.initial, version: 2 })),
  ).toThrow();
  expect(requests).toHaveLength(0);
});

test("603 pauses after exactly eight native GETs without publishing rows or rejected VIN presence", async () => {
  const requests = serve();
  let batches = 0;
  const result = await Effect.runPromise(
    streamSix03InventoryWithRequestGate(
      {
        maxPages: 8,
        onBatch: () =>
          Effect.sync(() => {
            batches++;
          }),
      },
      gate,
    ),
  );
  expect(requests).toHaveLength(8);
  expect(result.status).toBe("paused");
  expect(result.count).toBe(0);
  expect(result.observedVins).toEqual([]);
  expect(batches).toBe(0);
  expect(result.cursor.phase).toBe("details");
});

let cachedClosing: Six03Progress | undefined;
function closingState(): Six03Progress {
  if (cachedClosing) return cachedClosing;
  const catalog = parseSix03Catalog(fixtures.catalog);
  const details = six03PendingPosts(catalog).map((post) =>
    parseSix03Detail(six03FixtureDetail(post[0]), post),
  );
  cachedClosing = Six03Cursor.checkpoint({
    ...Six03Cursor.initial,
    phase: "closing",
    contact: parseSix03Contact(fixtures.contact),
    catalog,
    details,
    requests: details.length + 2,
    day: ModelCensus.day(Date.parse("2026-11-22")),
  });
  return cachedClosing;
}

test("603 changed closing contact, roster or donor evidence stops before any callbacks", async () => {
  const seed = closingState();
  const mutations: [number, (url: string, html: string) => string][] = [
    [0, (_url, html) => html.replaceAll("233 Main St", "5 Westville Road")],
    [1, (_url, html) => html.replace('data-year="2000"', 'data-year="2001"')],
    [
      2,
      (_url, html) =>
        html.replaceAll(
          "2005 Infiniti Infiniti FX",
          "2005 Infiniti Infiniti QX",
        ),
    ],
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

test("603 a completed checkpoint performs no requests or repeated emission", async () => {
  const requests = serve();
  let callbacks = 0;
  const result = await Effect.runPromise(
    streamSix03InventoryWithRequestGate(
      {
        startCursor: { source: "six03", version: 1, phase: "complete" },
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

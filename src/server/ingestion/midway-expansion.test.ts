import { afterEach, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  MIDWAY_CHUNK_SOFT_MS,
  streamMidwayInventoryWithRequestGate,
} from "./midway-connector";
import { openMidwayMakeCensus } from "./midway-catalog";
import { MidwayCursorSchema, type MidwayCursor } from "./midway-cursor";
import type { MidwayCanonicalVehicle } from "./midway-transform";
import { parseMidwayCatalog, parseMidwayMakeDirectory } from "./midway-parser";
import { MIDWAY_YARDS } from "./midway-yard-metadata";

const capture = z.object({
  url: z.string(),
  status: z.number(),
  headers: z.record(z.string()),
  raw: z.string(),
});
const saved = z
  .object({
    captures: z.array(capture),
    opening: capture,
    closing: capture,
    previous: z.array(
      z.object({ vin: z.string(), stockNumber: z.string().nullable() }),
    ),
    census: z.object({
      result: z.object({
        addressMatches: z.array(
          z.object({ coordinates: z.object({ x: z.number(), y: z.number() }) }),
        ),
      }),
    }),
  })
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL(
            "./midway-test-fixtures/tulsa-census.json.gz",
            import.meta.url,
          ),
        ),
        { maxOutputLength: 16 * 1024 * 1024 },
      ).toString("utf8"),
    ),
  );
afterEach(() => {
  spyOn(globalThis, "fetch").mockRestore();
  spyOn(Date, "now").mockRestore();
});

/** Replays the saved production census; each request costs `latencyMs`. */
function replayCensus(latencyMs = 0) {
  const requests: string[] = [];
  let broad = 0;
  let now = Date.now();
  spyOn(Date, "now").mockImplementation(() => now);
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        now += latencyMs;
        const response =
          url === saved.opening.url
            ? ++broad === 1
              ? saved.opening
              : saved.closing
            : saved.captures.find((c) => c.url === url);
        if (!response) throw new Error("Uncaptured Midway request: " + url);
        expect(new Headers(init?.headers).get("User-Agent")).toContain(
          "Chrome/120",
        );
        expect(new Headers(init?.headers).get("Accept")).toBe(
          "application/json,text/html;q=0.9,*/*;q=0.8",
        );
        requests.push(url);
        return new Response(response.raw, {
          status: response.status,
          headers: response.headers,
        });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  return { requests, broadRequests: () => broad };
}
const tulsaStart: MidwayCursor = {
  source: "midway",
  phase: "opening",
  yardCode: "OO95",
  observedVins: saved.previous.map((r) => r.vin),
  stocks: saved.previous.flatMap((r) => (r.stockNumber ? [r.stockNumber] : [])),
};
const tulsaVehicles = (vehicles: readonly MidwayCanonicalVehicle[]) =>
  vehicles.every(
    (v) =>
      v.stateAbbr === "OK" && v.detailsUrl === MIDWAY_YARDS.OO95.websiteUrl,
  );

test("Tulsa replays all 59 production make controls, closing and rejection accounting offline", async () => {
  const replay = replayCensus();
  const vehicles: MidwayCanonicalVehicle[] = [];
  let yards = 0;
  const result = await Effect.runPromise(
    streamMidwayInventoryWithRequestGate(
      {
        startCursor: tulsaStart,
        maxPages: 1,
        onBatch: (batch) =>
          Effect.sync(() => {
            expect(yards).toBe(0);
            vehicles.push(...batch);
          }),
        onYards: (values) =>
          Effect.sync(() => {
            yards++;
            expect(values).toEqual([MIDWAY_YARDS.OO95]);
          }),
      },
      (request) => request,
    ),
  );
  expect(vehicles).toHaveLength(1064);
  expect(tulsaVehicles(vehicles)).toBe(true);
  expect(result.status).toBe("complete");
  expect(result.accounting).toEqual({
    recordsProcessed: 1083,
    recordsRejected: 19,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  expect(yards).toBe(1);
  expect(replay.broadRequests()).toBe(2);
  expect(new Set(replay.requests).size).toBe(61);
  const makes = parseMidwayMakeDirectory(saved.opening.raw, "OO95");
  const counts = makes.map((make) => {
    const response = saved.captures.find(
      (c) =>
        new URL(c.url).pathname === `/inventory/${make.replace(" ", "_")}/ANY/`,
    );
    if (!response) throw new Error("Missing make " + make);
    return parseMidwayCatalog(response.raw, "OO95", make).length;
  });
  expect(counts).toHaveLength(59);
  expect(Math.max(...counts)).toBeLessThan(500);
  expect(counts.reduce((sum, n) => sum + n, 0)).toBe(1083);
  expect(saved.census.result.addressMatches[0]?.coordinates).toEqual({
    x: MIDWAY_YARDS.OO95.lng,
    y: MIDWAY_YARDS.OO95.lat,
  });
});

test("a captured empty make needs the exact native yard and make controls", () => {
  const empty = saved.captures.find((c) => c.url.includes("ALFA_ROMEO"));
  if (!empty) throw new Error("Missing empty response");
  expect(parseMidwayCatalog(empty.raw, "OO95", "ALFA ROMEO")).toEqual([]);
  expect(() => parseMidwayCatalog(empty.raw, "OO95", "FORD")).toThrow(
    "selected make and yard",
  );
  expect(() =>
    parseMidwayCatalog(
      empty.raw.replace('var urgID = "OO95"', 'var urgID = "MO09"'),
      "OO95",
      "ALFA ROMEO",
    ),
  ).toThrow();
});

test("a slow Tulsa make traversal checkpoints within the chunk budget and resumes without recrawling", async () => {
  // Production rejected two 07:00 runs when one chunk spent its whole
  // five-minute limit on Tulsa's 61 requests behind the shared URG host slot.
  const replay = replayCensus(15_000);
  const vehicles: MidwayCanonicalVehicle[] = [];
  const accounting = { processed: 0, rejected: 0 };
  let yards = 0;
  let cursor: MidwayCursor = tulsaStart;
  const chunks: { status: string; phase: string; makes: number }[] = [];
  while (cursor.phase !== "complete" && chunks.length < 20) {
    const result = await Effect.runPromise(
      streamMidwayInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages: 1,
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles.push(...batch);
            }),
          onYards: () =>
            Effect.sync(() => {
              yards++;
            }),
        },
        (request) => request,
      ),
    );
    accounting.processed += result.accounting?.recordsProcessed ?? 0;
    accounting.rejected += result.accounting?.recordsRejected ?? 0;
    // Every checkpoint survives durable JSON serialization.
    cursor = MidwayCursorSchema.parse(
      JSON.parse(JSON.stringify(result.cursor)),
    );
    chunks.push({
      status: result.status,
      phase: cursor.phase,
      makes: cursor.phase === "census" ? cursor.makes.length : 0,
    });
  }
  const perChunk = Math.ceil(MIDWAY_CHUNK_SOFT_MS / 15_000);
  expect(chunks.length).toBeGreaterThan(2);
  expect(chunks[0]).toEqual({
    status: "paused",
    phase: "census",
    makes: 59 - (perChunk - 2),
  });
  expect(chunks.at(-1)).toEqual({
    status: "complete",
    phase: "complete",
    makes: 0,
  });
  expect(chunks.slice(0, -1).every((c) => c.status === "paused")).toBe(true);
  // The make traversal is never published before the closing witness.
  expect(yards).toBe(1);
  expect(vehicles).toHaveLength(1064);
  expect(new Set(vehicles.map((v) => v.vin)).size).toBe(1064);
  expect(tulsaVehicles(vehicles)).toBe(true);
  expect(accounting).toEqual({ processed: 1083, rejected: 19 });
  // One opening and one closing broad view, each make exactly once, and only
  // the identity page repeats per chunk.
  expect(replay.broadRequests()).toBe(2);
  const repeated = replay.requests.filter(
    (url, index) => replay.requests.indexOf(url) !== index,
  );
  expect(new Set(repeated)).toEqual(
    new Set(["https://midwayupull.com/", saved.opening.url]),
  );
  expect(
    replay.requests.filter((url) => url === "https://midwayupull.com/"),
  ).toHaveLength(chunks.length);
});

test("a resumed Tulsa traversal still fails closed on missed donors, closing drift and rejections", async () => {
  const census = openMidwayMakeCensus(saved.opening.raw, "OO95");
  const closingCursor = {
    source: "midway",
    observedVins: tulsaStart.observedVins,
    stocks: tulsaStart.stocks,
    phase: "census",
    yardCode: "OO95",
    makes: [],
    witness: [],
    openingHash: census.openingHash,
    openingRows: census.openingRows,
    processed: 100,
    rejected: 0,
  } satisfies MidwayCursor;
  const cases: [MidwayCursor, string][] = [
    [
      { ...closingCursor, witness: census.witness.slice(0, 1) },
      "missed or changed 1 donors",
    ],
    [
      { ...closingCursor, openingHash: "0".repeat(64) },
      "closing witness changed",
    ],
    [{ ...closingCursor, rejected: 11 }, "10% rejection limit"],
    [{ ...closingCursor, rejected: 100 }, "no accepted donor"],
  ];
  for (const [startCursor, message] of cases) {
    replayCensus();
    let yards = 0;
    await expect(
      Effect.runPromise(
        streamMidwayInventoryWithRequestGate(
          {
            startCursor,
            onBatch: () => Effect.void,
            onYards: () =>
              Effect.sync(() => {
                yards++;
              }),
          },
          (request) => request,
        ),
      ),
    ).rejects.toThrow(message);
    expect(yards).toBe(0);
  }
});

import { afterEach, expect, test } from "bun:test";
import { brotliDecompressSync } from "node:zlib";
import { Effect, Either } from "effect";
import { z } from "zod";
import {
  type Alln1StreamResult,
  streamAlln1InventoryWithRequestGate,
} from "./alln1-connector";
import { Alln1Cursor, Alln1CursorSchema } from "./alln1-cursor";
import type { Alln1CanonicalVehicle } from "./alln1-transform";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";
import {
  type QueuedHostRun,
  runWithQueuedHost,
} from "./provider-host-test-support";
import {
  newestVehicleArrival,
  validateSourceSnapshot,
} from "./source-validation";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
// Live alln1kc.com responses from November 19, 2026, with their cache headers.
// Canonical inventory pages came from a Varnish cache of different ages
// (page 1 HIT 145,950 s, page 2 HIT 120,868 s, page 3 a fresh MISS). The cb
// pages were fetched 23 seconds apart with unique nonces and all missed, as
// did the cache-busted search for the 2026-08-28 Set Date. The root is read
// as published (HIT, age 1,614): it proves only the yard's identity.
const archive = z
  .object({
    responses: z.array(
      z.object({
        label: z.string(),
        url: z.string(),
        status: z.number(),
        headers: z.array(z.tuple([z.string(), z.string()])),
        html: z.string(),
      }),
    ),
  })
  .parse(
    JSON.parse(
      brotliDecompressSync(
        await Bun.file(
          new URL("./alln1-test-fixtures/alln1-cache.json.br", import.meta.url),
        ).bytes(),
      ).toString(),
    ),
  );
const capture = (label: string) => {
  const saved = archive.responses.find((entry) => entry.label === label);
  if (!saved) throw new Error("Missing saved All-N-1 capture " + label);
  return saved;
};
const inventory = "https://alln1kc.com/inventory/ANY/ANY/?k=1&view=table";
const canonical = new Map([
  ["https://alln1kc.com/", "owner"],
  [inventory, "stale-p1"],
  [inventory + "&pagenum=2", "stale-p2"],
  [inventory + "&pagenum=3", "fresh-p3"],
]);
const busted = new Map([
  ["pagenum=", "cb-p1"],
  ["pagenum=2", "cb-p2"],
  ["pagenum=3", "cb-p3"],
  ["search=2026-08-28", "cb-search-2026-08-28"],
]);
const SEARCH = "cb-search-2026-08-28";
const row = (label: string, stock: string) => {
  const html = capture(label).html;
  const start = html.lastIndexOf(
    "<tr>",
    html.indexOf('data-lightbox="' + stock + '-table"'),
  );
  const end = html.indexOf("</tr>", start) + "</tr>".length;
  if (start < 0 || end < start)
    throw new Error("Missing saved All-N-1 row " + stock);
  return html.slice(start, end);
};
/** Replaces the first Set Date cell in `html`. */
const redate = (html: string, date: string) =>
  html.replace(/(<td>\s*)\d{4}-\d{2}-\d{2}(\s*<\/td>)/, "$1" + date + "$2");
/** The last donor row of a capture and the Set Date of its last row. */
const tail = (label: string) => {
  const html = capture(label).html;
  const start = html.lastIndexOf("<tr>");
  const end = html.indexOf("</tr>", start) + "</tr>".length;
  const date = [...html.matchAll(/<td>\s*(\d{4}-\d{2}-\d{2})\s*<\/td>/g)].at(
    -1,
  )?.[1];
  if (start < 0 || end < start || date === undefined)
    throw new Error("Missing saved All-N-1 last row in " + label);
  return { row: html.slice(start, end), date };
};
/**
 * The fresh census splits the 2026-08-28 Set Date tie at the page 1/2
 * boundary: stock 261947 ends page 1 and starts page 2, and 261948 (between
 * them in the cached November 18 snapshot) is on neither page. Restoring that
 * order gives a census whose tie is not split.
 */
const restoreTieOrder = (html: string) =>
  html.replace(row("cb-p2", "261947"), row("stale-p1", "261948"));
/** Serves the site as captured: canonical URLs from its cache, and URLs with
 * a cb nonce from the origin, reflecting that nonce like the live plugin.
 * `rewrite` may change a cache-busted body before it is served. */
function mock(
  options: {
    headers?: (
      label: string,
      headers: [string, string][],
    ) => [string, string][];
    rewrite?: (label: string, html: string) => string;
  } = {},
) {
  const headers = options.headers ?? ((_label, saved) => saved);
  const served: string[] = [];
  const nonces = new Set<string>();
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const raw = input instanceof Request ? input.url : String(input);
      const url = new URL(raw);
      const nonce = url.searchParams.get("cb");
      if (nonce === null) {
        const label = canonical.get(raw);
        if (label === undefined)
          throw new Error("Unsaved All-N-1 request " + raw);
        served.push(label);
        const saved = capture(label);
        return new Response(saved.html, {
          status: saved.status,
          headers: headers(label, saved.headers),
        });
      }
      if (!/^[a-f0-9]{16}$/.test(nonce) || nonces.has(nonce))
        throw new Error("All-N-1 nonce is not fresh: " + raw);
      nonces.add(nonce);
      const search = url.searchParams.get("search");
      const key =
        search === null
          ? "pagenum=" + (url.searchParams.get("pagenum") ?? "")
          : "search=" + search;
      const label = busted.get(key);
      const tail = key === "pagenum=" ? "" : "&" + key;
      if (label === undefined || raw !== inventory + "&cb=" + nonce + tail)
        throw new Error("Unsaved All-N-1 request " + raw);
      served.push(label);
      const saved = capture(label);
      const html = options.rewrite?.(label, saved.html) ?? saved.html;
      return new Response(
        html.replace(/1dfbcad9a189[abc]|6b2e68d7b85be/g, nonce),
        { status: saved.status, headers: headers(label, saved.headers) },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return served;
}
async function census(budget: number) {
  let cursor: Alln1Cursor = Alln1Cursor.initial;
  const vehicles: Alln1CanonicalVehicle[] = [];
  const observedVins: string[] = [];
  const nextUrls: string[] = [];
  const warnings: string[] = [];
  let processed = 0,
    rejected = 0,
    duplicates = 0;
  while (cursor.phase !== "complete") {
    const result: Alln1StreamResult = await Effect.runPromise(
      streamAlln1InventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages: budget,
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles.push(...batch);
            }),
        },
        gate,
      ),
    );
    processed += result.accounting?.recordsProcessed ?? 0;
    rejected += result.accounting?.recordsRejected ?? 0;
    duplicates += result.accounting?.duplicateVehicles ?? 0;
    observedVins.push(...(result.observedVins ?? []));
    warnings.push(...(result.warnings ?? []));
    cursor = parseDurableSourceCursor(
      "alln1",
      serializeDurableSourceCursor(result.cursor),
    );
    if (cursor.phase === "pages") nextUrls.push(cursor.nextUrl);
  }
  return {
    vehicles,
    observedVins,
    nextUrls,
    warnings,
    processed,
    rejected,
    duplicates,
  };
}
function expectAcceptedCensus(
  result: Awaited<ReturnType<typeof census>>,
  duplicates: number,
) {
  expect(result.rejected).toBe(45);
  expect(result.vehicles).toHaveLength(1079);
  expect(new Set(result.vehicles.map((vehicle) => vehicle.vin)).size).toBe(
    1079,
  );
  expect(result.processed).toBe(1079 + 45 + duplicates);
  expect(result.duplicates).toBe(duplicates);
  // Donors cached page 2 pushed onto page 3 appear exactly once, both donors
  // of the split 2026-08-28 tie are accepted, and a November 18 HOLD arrival
  // missing from cached page 1 is observed.
  for (const stock of ["260941", "260944", "260842", "260843", "261947"])
    expect(
      result.vehicles.filter((vehicle) => vehicle.stockNumber === stock),
    ).toHaveLength(1);
  expect(
    result.vehicles.find((vehicle) => vehicle.stockNumber === "261948")?.vin,
  ).toBe("5GRGN22U65H116600");
  expect(
    result.observedVins.filter((vin) => vin === "5N1AT2MT7HC801834"),
  ).toHaveLength(1);
  expect(
    validateSourceSnapshot({
      source: "alln1",
      terminal: true,
      uniqueVehicles: result.vehicles.length,
      vehiclesProcessed: result.processed,
      rejectedVehicles: result.rejected,
      duplicateVehicles: result.duplicates,
      previousAcceptedCount: null,
      newestVehicleDate: newestVehicleArrival(
        result.vehicles,
        new Date("2026-11-20"),
      ),
      validatedAt: new Date("2026-11-20"),
      errors: [],
    }).errors,
  ).toEqual([]);
}

test.each([3, 1])(
  "All-N-1 reads the captured census from origin and recovers the Set Date tie it splits, budget %i",
  async (budget) => {
    // Cached page 2 ends with the first 12 donors of fresh page 3, so reading
    // the cache repeats them on page 3. Fresh pages repeat 261947 across the
    // page 1/2 boundary and hide 261948; the 2026-08-28 search recovers it.
    const served = mock();
    const result = await census(budget);
    expectAcceptedCensus(result, 1);
    expect(result.warnings).toContain(
      "All-N-1 page boundaries split the Set Date ties 2026-08-28; their native Set Date searches recovered the donors the pages hid.",
    );
    // Every inventory read, including resume anchors and closing reads,
    // missed the cache with its own nonce; checkpoints keep canonical
    // continuations, and a tie found in one chunk is searched in the last.
    expect(served).toEqual(
      budget === 3
        ? ["owner", "cb-p1", "cb-p2", "cb-p3", SEARCH, "owner", "cb-p1"]
        : [
            ...["owner", "cb-p1"],
            ...["owner", "cb-p1", "cb-p2"],
            ...["owner", "cb-p1", "cb-p3", SEARCH, "owner", "cb-p1"],
          ],
    );
    expect(result.nextUrls).toEqual(
      budget === 3 ? [] : [inventory + "&pagenum=2", inventory + "&pagenum=3"],
    );
  },
);

test("All-N-1 requests no Set Date search when no page repeats a donor", async () => {
  const served = mock({
    rewrite: (label, html) =>
      label === "cb-p2" ? restoreTieOrder(html) : html,
  });
  const result = await census(3);
  expectAcceptedCensus(result, 0);
  expect(served).toEqual([
    "owner",
    "cb-p1",
    "cb-p2",
    "cb-p3",
    "owner",
    "cb-p1",
  ]);
});

test.each([
  [
    "adds a donor the catalog never repeated",
    SEARCH,
    (html: string) =>
      html.replace(
        "</tbody>",
        redate(row("cb-p1", "262482"), "2026-08-28") + "</tbody>",
      ),
    "adds 2, but the catalog repeated 1",
  ],
  [
    "omits a census donor of that date",
    SEARCH,
    (html: string) => html.replace(row("cb-p1", "261947"), ""),
    "omits 1 census donors of that date",
  ],
  [
    "lists a donor set on another date",
    SEARCH,
    (html: string) => redate(html, "2026-08-27"),
    "returned donors set on another date",
  ],
  [
    "publishes pagination",
    SEARCH,
    (html: string) =>
      html.replace(
        "</table>",
        '</table><a href="/inventory/ANY/ANY/?k=1&#038;view=table&#038;pagenum=2">2</a>',
      ),
    "publishes pagination",
  ],
  [
    "repeats a donor away from a page boundary",
    "cb-p3",
    // Page 2's last donor again at the end of page 3, dated to keep the
    // catalog ordered: not the previous page's boundary tie.
    (html: string) =>
      html.replace(
        "</tbody>",
        redate(tail("cb-p2").row, tail("cb-p3").date) + "</tbody>",
      ),
    "Native pages repeat a donor",
  ],
] as const)(
  "All-N-1 fails closed when the census %s",
  async (_name, target, change, message) => {
    mock({
      rewrite: (label, html) => (label === target ? change(html) : html),
    });
    let callbacks = 0;
    const run = Effect.runPromise(
      streamAlln1InventoryWithRequestGate(
        {
          maxPages: 3,
          onBatch: () =>
            Effect.sync(() => {
              callbacks++;
            }),
        },
        gate,
      ),
    );
    await expect(run).rejects.toThrow(message);
    await expect(run).rejects.toThrow("previous inventory is preserved");
    expect(callbacks).toBe(0);
  },
);

test.each([
  ["page 1 marked HIT", "cb-p1", [["x-cache", "HIT"]], 0],
  ["page 2 with a cache age", "cb-p2", [["age", "120868"]], 0],
  ["closing page 1 marked HIT", "cb-p1", [["x-cache", "HIT"]], 1],
  ["page 3 with an unreadable age", "cb-p3", [["age", "unknown"]], 0],
  ["page 2 with a Cloudflare HIT", "cb-p2", [["cf-cache-status", "HIT"]], 0],
  [
    "Set Date search marked HIT with age",
    SEARCH,
    [
      ["x-cache", "HIT"],
      ["age", "1614"],
    ],
    0,
  ],
  [
    "Set Date search with a stale Cloudflare copy",
    SEARCH,
    [["cf-cache-status", "STALE"]],
    0,
  ],
] as const)(
  "All-N-1 fails closed when a cache-busted read is still cached: %s",
  async (_name, target, stale, after) => {
    let reads = 0;
    mock({
      headers: (label, headers) =>
        label === target && reads++ >= after
          ? [
              ...headers.filter(
                ([name]) => !stale.some(([staleName]) => staleName === name),
              ),
              ...stale.map(([name, value]): [string, string] => [name, value]),
            ]
          : headers,
    });
    let callbacks = 0;
    const run = Effect.runPromise(
      streamAlln1InventoryWithRequestGate(
        {
          maxPages: 3,
          onBatch: () =>
            Effect.sync(() => {
              callbacks++;
            }),
        },
        gate,
      ),
    );
    await expect(run).rejects.toThrow("despite its unique cb cache-busting");
    await expect(run).rejects.toThrow("previous inventory is preserved");
    expect(callbacks).toBe(0);
  },
);

test("All-N-1 rejects a page that reflects another request's nonce", async () => {
  mock();
  const served = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const response = await served(input);
      if (!new URL(String(input)).searchParams.has("pagenum")) return response;
      // A cached copy of another cache-busted read of page 2.
      const html = (await response.text()).replace(
        /cb=[a-f0-9]{16}&#038;pagenum=/g,
        "cb=0123456789abcdef&#038;pagenum=",
      );
      return new Response(html, { headers: response.headers });
    },
    { preconnect: originalFetch.preconnect },
  );
  await expect(
    Effect.runPromise(
      streamAlln1InventoryWithRequestGate(
        { maxPages: 3, onBatch: () => Effect.void },
        gate,
      ),
    ),
  ).rejects.toThrow("unsupported continuation");
});

/** Simulated origin latency for the root and for every inventory read
 * (November 19 measured 18 to 26 s uncached, and 19.3 s for the root). */
const latency = (rootMs: number, inventoryMs: number) => (url: string) =>
  url === "https://alln1kc.com/" ? rootMs : inventoryMs;

test.each([
  // At measured latency the whole census, its tie search and closing reads
  // take about 190 s of chunk work, over the old fixed 3-minute budget.
  [19_300, 26_000, ["complete"]],
  // Slower reads cannot finish the tie search and closing reads by the turn
  // horizon, so the chunk checkpoints every admitted page and the next chunk
  // runs only those reads.
  [19_300, 58_000, ["paused:closing", "complete"]],
  // Every read slow, the root included, up to the 60 s read timeout: no turn
  // holds more than three reads plus the searches, so no chunk can be
  // deferred again and again.
  [50_000, 55_000, ["paused:closing", "complete"]],
  [59_000, 59_000, ["paused:closing", "complete"]],
] as const)(
  "All-N-1 never fails or keeps deferring a healthy census on a slow origin (root %i ms, reads %i ms)",
  async (rootMs, inventoryMs, expected) => {
    mock();
    let cursor: Alln1Cursor = Alln1Cursor.initial;
    const vehicles: Alln1CanonicalVehicle[] = [];
    const statuses: string[] = [];
    while (cursor.phase !== "complete" && statuses.length < 5) {
      const chunk: QueuedHostRun<Alln1StreamResult, unknown> =
        await runWithQueuedHost(
          streamAlln1InventoryWithRequestGate(
            {
              startCursor: cursor,
              maxPages: 3,
              onBatch: (batch) =>
                Effect.sync(() => {
                  vehicles.push(...batch);
                }),
            },
            gate,
          ),
          { turnWaitMs: 0, requestMs: latency(rootMs, inventoryMs) },
        );
      if (Either.isLeft(chunk.result)) throw chunk.result.left;
      expect(chunk.elapsedMs).toBeLessThanOrEqual(6 * 60_000);
      cursor = parseDurableSourceCursor(
        "alln1",
        serializeDurableSourceCursor(chunk.result.right.cursor),
      );
      if (cursor.phase === "closing")
        // A closing checkpoint binds its ledger: dropping the last page's
        // receipt or claiming another page fails validation.
        for (const tampered of [
          { ...cursor, receipts: cursor.receipts.slice(0, -1) },
          { ...cursor, lastPage: cursor.lastPage + 1 },
          { ...cursor, seen: cursor.seen.slice(1) },
        ])
          expect(Alln1CursorSchema.safeParse(tampered).success).toBe(false);
      statuses.push(
        chunk.result.right.status === "paused"
          ? "paused:" + cursor.phase
          : chunk.result.right.status,
      );
    }
    expect(statuses).toEqual([...expected]);
    expect(new Set(vehicles.map((vehicle) => vehicle.vin)).size).toBe(1079);
    expect(vehicles.some((vehicle) => vehicle.stockNumber === "261948")).toBe(
      true,
    );
  },
  60_000,
);

/** A real closing checkpoint: the slow first chunk admits every page, then
 * defers its finishing turn (searches and closing reads). */
async function closingCursor() {
  mock();
  const chunk: QueuedHostRun<Alln1StreamResult, unknown> =
    await runWithQueuedHost(
      streamAlln1InventoryWithRequestGate(
        { maxPages: 3, onBatch: () => Effect.void },
        gate,
      ),
      { turnWaitMs: 0, requestMs: latency(19_300, 58_000) },
    );
  if (Either.isLeft(chunk.result)) throw chunk.result.left;
  const cursor = parseDurableSourceCursor(
    "alln1",
    serializeDurableSourceCursor(chunk.result.right.cursor),
  );
  if (cursor.phase !== "closing")
    throw new Error("Expected a closing checkpoint, got " + cursor.phase);
  return cursor;
}

test.each([
  ["unchanged", (html: string) => html, null],
  [
    "page 1 changed since the census began",
    (html: string) =>
      html.replace(/(<td>\s*)ROGUE(\s*<\/td>)/, "$1ROGUE SPORT$2"),
    "first-page inventory anchor or pagination changed during the crawl",
  ],
] as const)(
  "All-N-1 resumes a closing checkpoint only against its opening anchor: %s",
  async (_name, change, message) => {
    const cursor = await closingCursor();
    const served = mock({
      rewrite: (label, html) => (label === "cb-p1" ? change(html) : html),
    });
    let callbacks = 0;
    const run = Effect.runPromise(
      streamAlln1InventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages: 3,
          onBatch: () =>
            Effect.sync(() => {
              callbacks++;
            }),
        },
        gate,
      ),
    );
    // A closing chunk makes only its finishing reads, which are also its
    // resume check against the opening owner, scope and anchor.
    if (message === null) {
      expect((await run).status).toBe("complete");
      expect(callbacks).toBe(1);
    } else {
      await expect(run).rejects.toThrow(message);
      await expect(run).rejects.toThrow("previous inventory is preserved");
      expect(callbacks).toBe(0);
    }
    expect(served).toEqual([SEARCH, "owner", "cb-p1"]);
  },
  60_000,
);

test("All-N-1 rejects closing ledgers that break coverage even with a fresh checksum", async () => {
  const cursor = await closingCursor();
  const ledger = {
    scopeHash: cursor.scopeHash,
    anchorHash: cursor.anchorHash,
    lastPage: cursor.lastPage,
    seen: cursor.seen,
    receipts: cursor.receipts,
    setDates: cursor.setDates,
  };
  const [first, ...rest] = ledger.receipts;
  const last = rest.at(-1);
  if (!first || !last)
    throw new Error("Closing checkpoint needs at least two receipts");
  for (const forged of [
    // One page short of the published directory.
    { ...ledger, lastPage: ledger.lastPage + 1 },
    // A partial page before the last one.
    {
      ...ledger,
      receipts: [last, ...rest.slice(0, -1), first],
    },
    // Donor states that do not add up to the receipts.
    { ...ledger, seen: ledger.seen.slice(1) },
  ])
    expect(() => Alln1Cursor.closing(forged)).toThrow(
      "page coverage, identities or integrity is inconsistent",
    );
  expect(Alln1Cursor.closing(ledger)).toEqual(cursor);
}, 60_000);

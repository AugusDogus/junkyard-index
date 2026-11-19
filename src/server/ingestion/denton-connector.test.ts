import { afterEach, expect, test } from "bun:test";
import { Effect, Either } from "effect";
import {
  streamDentonInventory,
  streamDentonInventoryWithRequestGate,
  type DentonStreamResult,
} from "./denton-connector";
import { runWithQueuedHost } from "./provider-host-test-support";
import {
  DentonCursor,
  dentonNextUrl,
  DENTON_MINIMUM_INVENTORY,
} from "./denton-cursor";
import { dentonHash } from "./denton-traversal";
import { dentonTestGraph, dentonTestVin } from "./denton-test-fixtures";
import { DENTON_MAX_BODY_BYTES } from "./denton-client";

async function collect(
  graph: ReturnType<typeof dentonTestGraph>,
  prior: number | null = null,
) {
  let wire: string | undefined,
    batches = 0,
    yards = 0,
    chunks = 0;
  let final: DentonStreamResult | undefined;
  for (let count = 0; count < 100; count++) {
    const result = await Effect.runPromise(
      streamDentonInventory({
        previousAcceptedCount: prior,
        startCursor: wire,
        readPage: graph.read,
        maxPages: 3,
        onBatch: (vehicles) =>
          Effect.sync(() => {
            batches++;
            expect(vehicles.length).toBeGreaterThanOrEqual(2000);
          }),
        onYards: () =>
          Effect.sync(() => {
            yards++;
          }),
      }),
    );
    chunks++;
    expect(result.pagesProcessed).toBeLessThanOrEqual(3);
    const encoded = DentonCursor.serialize(result.cursor, prior);
    if (!encoded.ok) throw new Error(encoded.error.message);
    wire = encoded.value;
    if (result.status === "complete") {
      final = result;
      break;
    }
    expect(batches).toBe(0);
    expect(yards).toBe(0);
    expect(result.count).toBe(0);
    expect(result.observedVins).toEqual([]);
    expect(result.rejections).toEqual([]);
    expect(result.accounting.recordsProcessed).toBe(0);
  }
  if (!final || !wire) throw new Error("Test graph did not terminate");
  return { final, wire, batches, yards, chunks };
}

// The full saved census and checkpoint replays can exceed five seconds in CI.
test("Denton serializes every chunk, counts redirects, stages only terminal data and makes completed reentry inert", async () => {
  const graph = dentonTestGraph();
  const result = await collect(graph);
  expect(DENTON_MINIMUM_INVENTORY).toBe(765);
  expect(result.final.count).toBe(2000);
  expect(result.final.accounting).toEqual({
    recordsProcessed: 2000,
    recordsRejected: 0,
    duplicateVehicles: 0,
    recordsExcluded: 0,
  });
  expect(result.final.cursor.requests).toBe(22);
  expect(graph.calls).toHaveLength(22);
  expect(result.chunks).toBe(8);
  expect(result.batches).toBe(1);
  expect(result.yards).toBe(1);
  const again = await Effect.runPromise(
    streamDentonInventory({
      previousAcceptedCount: null,
      startCursor: result.wire,
      readPage: graph.read,
      onBatch: () => Effect.die("unexpected staging"),
      onYards: () => Effect.die("unexpected yard"),
    }),
  );
  expect(again.status).toBe("complete");
  expect(again.pagesProcessed).toBe(0);
  expect(graph.calls).toHaveLength(22);
}, 15_000);

test("Denton resumes pending slash canonicalization with no hidden logical request", async () => {
  const graph = dentonTestGraph();
  const first = await Effect.runPromise(
    streamDentonInventory({
      previousAcceptedCount: 2000,
      readPage: graph.read,
      maxPages: 4,
      onBatch: () => Effect.void,
    }),
  );
  expect(first.cursor.pending?.target).toBe(
    "https://dentonauto.com/used-parts/ACURA/",
  );
  const encoded = DentonCursor.serialize(first.cursor, 2000);
  if (!encoded.ok) throw new Error(encoded.error.message);
  const restored = DentonCursor.fromWire(encoded.value, 2000);
  if (!restored.ok) throw new Error(restored.error.message);
  expect(dentonNextUrl(restored.value)).toEqual({
    ok: true,
    value: "https://dentonauto.com/used-parts/ACURA/",
  });
  expect(DentonCursor.fromWire(encoded.value, null).ok).toBe(false);
  const signed = { ...first.cursor, requests: 3, checksum: undefined };
  expect(
    DentonCursor.parse({ ...signed, checksum: dentonHash(signed) }, 2000).ok,
  ).toBe(false);
  expect(
    DentonCursor.parse({ ...first.cursor, phase: "complete" }, 2000).ok,
  ).toBe(false);
});

test("Denton source floor, rejection, duplicate and prior drift guards apply to the cumulative terminal corpus", async () => {
  // Keep multiple model pages and serialized resumes without replaying the
  // 2,000-donor happy-path corpus for each independent terminal guard.
  for (const [options, prior, message] of [
    [{ accepted: 764 }, null, "qualified minimum is 765"],
    [{ accepted: 800, rejectsPerPage: 50 }, null, "10% limit"],
    [
      { accepted: 900, rowsPerPage: 300, duplicatesPerPage: 120 },
      null,
      "25% limit",
    ],
    [{ accepted: 800 }, 2000, "50% prior-drift floor"],
  ] as const) {
    await expect(collect(dentonTestGraph(options), prior)).rejects.toThrow(
      message,
    );
  }
}, 20_000);

// The full saved census and checkpoint replays can exceed five seconds in CI.
test("Denton closing proof catches middle donor drift, loss of controls and geography changes before callbacks", async () => {
  for (const kind of ["model", "menu", "contact"] as const) {
    const graph = dentonTestGraph();
    let start: unknown;
    for (let i = 0; i < 4; i++) {
      const part = await Effect.runPromise(
        streamDentonInventory({
          previousAcceptedCount: null,
          startCursor: start,
          readPage: graph.read,
          maxPages: 3,
          onBatch: () => Effect.die("unexpected staging"),
        }),
      );
      start = part.cursor;
    }
    const url =
      kind === "model"
        ? "https://dentonauto.com/used-parts/ACURA/MDX2/"
        : kind === "menu"
          ? "https://dentonauto.com/used-parts/ACURA/"
          : "https://dentonauto.com/contact/";
    const body = graph.pages.get(url);
    if (!body) throw new Error("Missing fixture");
    graph.pages.set(
      url,
      kind === "model"
        ? body.replace("2017", "2018")
        : kind === "menu"
          ? body.replace(/<a\b[^>]*>MDX2[\s\S]*?<\/a>/, "")
          : body.replace("-95.686134", "-95.0"),
    );
    const run = Effect.gen(function* () {
      for (let i = 0; i < 10; i++) {
        const part = yield* streamDentonInventory({
          previousAcceptedCount: null,
          startCursor: start,
          readPage: graph.read,
          onBatch: () => Effect.die("unexpected staging"),
        });
        start = part.cursor;
      }
    });
    expect((await Effect.runPromise(Effect.either(run)))._tag).toBe("Left");
  }
}, 15_000);

test("Denton does not return a terminal checkpoint when the final staging callback fails", async () => {
  const graph = dentonTestGraph();
  let start: unknown;
  for (let i = 0; i < 3; i++) {
    const part = await Effect.runPromise(
      streamDentonInventory({
        previousAcceptedCount: null,
        startCursor: start,
        maxPages: 6,
        readPage: graph.read,
        onBatch: () => Effect.die("too early"),
      }),
    );
    start = part.cursor;
  }
  const failed = await Effect.runPromise(
    Effect.either(
      streamDentonInventory({
        previousAcceptedCount: null,
        startCursor: start,
        readPage: graph.read,
        onBatch: () => Effect.fail("staging unavailable"),
      }),
    ),
  );
  expect(failed).toMatchObject({ _tag: "Left", left: "staging unavailable" });
  expect(DentonCursor.parse(start, null)).toMatchObject({
    ok: true,
    value: { phase: "active" },
  });
});

test("Denton retains all valid identities from cumulative required conflicts through serialized resumes", async () => {
  const graph = dentonTestGraph({ accepted: 2002 });
  const url = "https://dentonauto.com/used-parts/ACURA/MDX0/";
  const body = graph.pages.get(url);
  if (!body) throw new Error("Missing fixture");
  graph.pages.set(
    url,
    body
      .replace(
        `${dentonTestVin(0)}<br>`,
        `${dentonTestVin(0)}<br><b>Vin:</b> ${dentonTestVin(99999)}<br>`,
      )
      .replace(
        `${dentonTestVin(1)}<br>`,
        `${dentonTestVin(1)}<br><b>Year:</b> 1975<br><b>Vin:</b> ABC12345<br>`,
      ),
  );
  const { final } = await collect(graph);
  expect(final.count).toBe(2000);
  expect(final.rejections).toHaveLength(2);
  expect(new Set(final.observedVins)).toEqual(
    new Set([
      dentonTestVin(0),
      dentonTestVin(99999),
      dentonTestVin(1),
      "ABC12345",
    ]),
  );
});

test("Denton closing badges remain diagnostics and concrete ownership spill blocks all staging", async () => {
  const graph = dentonTestGraph();
  const read = graph.read;
  graph.read = (url) =>
    read(url).pipe(
      Effect.map((response) =>
        response.kind === "document" &&
        graph.calls.filter((call) => call === url).length > 1
          ? {
              ...response,
              body: response.body.replace(
                /class="badge">\d+/g,
                'class="badge">0',
              ),
            }
          : response,
      ),
    );
  expect((await collect(graph)).final.count).toBe(2000);
  const spill = dentonTestGraph({ accepted: 2001 });
  const url = "https://dentonauto.com/used-parts/ACURA/MDX0/",
    body = spill.pages.get(url);
  if (!body) throw new Error("Missing fixture");
  spill.pages.set(
    url,
    body.replace(
      "</a></div>",
      '</a><img data-src="https://da8h1v3w8q6n5.cloudfront.net/ok06/images/S0/S0_0.jpg"></div>',
    ),
  );
  await expect(collect(spill)).rejects.toThrow("foreign supplier");
}, 10_000);

test("Denton rejects invalid chunk sizes, whole-run counter tampering and oversized response/wire boundaries before staging", async () => {
  const graph = dentonTestGraph();
  for (const maxPages of [0, 9, 1.5]) {
    const result = await Effect.runPromise(
      Effect.either(
        streamDentonInventory({
          previousAcceptedCount: null,
          maxPages,
          readPage: graph.read,
          onBatch: () => Effect.die("unexpected staging"),
        }),
      ),
    );
    expect(result._tag).toBe("Left");
  }
  expect(graph.calls).toHaveLength(0);
  const initial = DentonCursor.initial(null);
  if (!initial.ok) throw new Error(initial.error.message);
  const url = dentonNextUrl(initial.value);
  if (!url.ok) throw new Error(url.error.message);
  expect(
    DentonCursor.advance(
      initial.value,
      {
        kind: "document",
        url: url.value,
        body: "x".repeat(DENTON_MAX_BODY_BYTES + 1),
      },
      null,
    ).ok,
  ).toBe(false);
  for (const values of [
    { requests: 2049 },
    { bytes: 256 * 1024 * 1024 + 1 },
    { requests: 1 },
    { bytes: 1 },
  ]) {
    const unsigned = { ...initial.value, ...values, checksum: undefined };
    expect(
      DentonCursor.parse({ ...unsigned, checksum: dentonHash(unsigned) }, null)
        .ok,
    ).toBe(false);
  }
  expect(DentonCursor.fromWire(" ".repeat(16 * 1024 * 1024 + 1), null).ok).toBe(
    false,
  );
});

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("Denton keeps advancing when every GET waits two minutes for a shared host turn", async () => {
  // Production URG queue on 2026-11-19: about 20 sources shared one lease, so
  // each request, including the native slash 301, waited about two minutes.
  const graph = dentonTestGraph();
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const page = Effect.runSync(Effect.either(graph.read(url)));
      if (Either.isLeft(page)) throw new Error(page.left.message);
      return page.right.kind === "redirect"
        ? new Response(null, {
            status: 301,
            headers: {
              location: page.right.target,
              "content-type": "text/html",
              "content-length": "0",
            },
          })
        : new Response(page.right.body, {
            headers: { "content-type": "text/html" },
          });
    },
    { preconnect: originalFetch.preconnect },
  );
  let wire: string | undefined;
  let batches = 0;
  const pages: number[] = [];
  for (let count = 0; count < 40; count++) {
    const chunk = await runWithQueuedHost(
      streamDentonInventoryWithRequestGate(
        {
          previousAcceptedCount: null,
          startCursor: wire,
          maxPages: 8,
          onBatch: () =>
            Effect.sync(() => {
              batches++;
            }),
        },
        (request) => request,
      ),
      { turnWaitMs: 2 * 60_000 },
    );
    if (Either.isLeft(chunk.result)) throw new Error(chunk.result.left.message);
    const result = chunk.result.right;
    pages.push(result.pagesProcessed);
    // Every chunk returns its checkpoint and releases each lease in time.
    expect(chunk.elapsedMs).toBeLessThanOrEqual(6 * 60_000);
    expect(chunk.turns.every((turn) => turn.releasedAt !== null)).toBe(true);
    const encoded = DentonCursor.serialize(result.cursor, null);
    if (!encoded.ok) throw new Error(encoded.error.message);
    wire = encoded.value;
    if (result.status === "complete") {
      expect(result.count).toBe(2000);
      break;
    }
  }
  expect(pages.reduce((sum, value) => sum + value, 0)).toBe(22);
  expect(pages.every((value) => value > 0)).toBe(true);
  expect(graph.calls).toHaveLength(22);
  expect(batches).toBe(1);
}, 120_000);

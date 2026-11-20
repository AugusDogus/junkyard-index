import { afterEach, expect, test } from "bun:test";
import { Effect, Either } from "effect";
import {
  ScottsCursor,
  SCOTTS_MAX_CURSOR_BYTES,
  type ScottsCursor as Cursor,
} from "./scotts-cursor";
import {
  streamScottsInventory,
  streamScottsInventoryWithRequestGate,
  type ScottsStreamResult,
} from "./scotts-connector";
import type { ScottsCanonicalVehicle } from "./scotts-transform";
import {
  SCOTTS_MAKES,
  SCOTTS_ORIGIN,
  SCOTTS_ROOT,
} from "./scotts-yard-metadata";
import { runWithQueuedHost } from "./provider-host-test-support";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const document = (body: string) =>
  `<html><body><h1>Scott's Used Parts</h1><a href="tel:9704980662">Call</a><p>938 West Willox Lane, Fort Collins, Colorado 80524. Scott's Used Parts is a full-service supplier of salvaged and used auto parts</p><script>var urgid = 'CC68,XX00'; var apsFrontend = {"makesBrowseUrl":"${SCOTTS_MAKES}#aps-search-by-makes"};</script>${body}</body></html>`;
const directory = (kind: "make" | "model", path: string, label: string) =>
  document(
    `<a class="aps-${kind}-link" href="${SCOTTS_ORIGIN + path}"><span class="aps-make-link__label">${label}</span><span class="aps-make-link__count">800</span></a>`,
  );
function fixture() {
  const cards = Array.from(
    { length: 800 },
    (_, index) =>
      `<div class="aps-la-card-wrapper"><div class="aps-la-card-premium" id="T${index}"><a class="aps-la-card-link-premium" href="${SCOTTS_ORIGIN}/used-parts/ACURA/CL/T${index}/1997"><h3 class="aps-la-title-premium">ACURA CL</h3><p class="aps-la-subtitle-premium--vin">VIN: 1HGCM82633A${String(index).padStart(6, "0")}</p><div class="aps-la-right-val-premium"><span>Year</span>1997</div></a></div></div>`,
  ).join("");
  const pages = new Map([
    [SCOTTS_ROOT, document("")],
    [SCOTTS_MAKES, directory("make", "/used-parts/ACURA", "ACURA")],
    [
      SCOTTS_ORIGIN + "/used-parts/ACURA",
      directory("model", "/used-parts/ACURA/CL", "CL"),
    ],
    [
      SCOTTS_ORIGIN + "/used-parts/ACURA/CL",
      document(
        `<h1>Used ACURA CL</h1><p>Some vehicles may not show parts available if we haven't parted them out yet.</p><div class="aps-la-grid">${cards}</div>`,
      ),
    ],
  ]);
  const requested: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      requested.push(url);
      const body = pages.get(url);
      if (body === undefined)
        throw new Error("Unexpected fixture request " + url);
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
    { preconnect: original.preconnect },
  );
  return { pages, requested };
}

test("Scotts resumes serialized prefixes and emits once after all closing controls", async () => {
  const { requested } = fixture();
  let cursor: Cursor = ScottsCursor.initial;
  let vehicles: ScottsCanonicalVehicle[] = [];
  let yards = 0;
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamScottsInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages: 2,
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles = batch;
            }),
          onYards: (batch) =>
            Effect.sync(() => {
              yards += batch.length;
            }),
        },
        gate,
      ),
    );
    cursor = ScottsCursor.parse(ScottsCursor.serialize(result.cursor));
    if (result.status === "paused") {
      expect(vehicles).toEqual([]);
      expect(result.accounting.recordsProcessed).toBe(0);
    } else expect(result.count).toBe(800);
  }
  expect(vehicles).toHaveLength(800);
  expect(yards).toBe(1);
  // Opening root, makes, one menu and one model; closing root and makes.
  expect(requested).toHaveLength(6);
  await Effect.runPromise(
    streamScottsInventoryWithRequestGate(
      {
        startCursor: cursor,
        onBatch: () => Effect.die("terminal replay emitted"),
      },
      gate,
    ),
  );
  expect(requested).toHaveLength(6);
});

test("Scotts closing changes and staging failure preserve an unfinished checkpoint", async () => {
  const { pages } = fixture();
  const opening = await Effect.runPromise(
    streamScottsInventoryWithRequestGate(
      { maxPages: 4, onBatch: () => Effect.void },
      gate,
    ),
  );
  expect(opening.cursor.phase).toBe("closing");
  pages.set(SCOTTS_ROOT, document("").replace("CC68,XX00", "FOREIGN"));
  await expect(
    Effect.runPromise(
      streamScottsInventoryWithRequestGate(
        {
          startCursor: opening.cursor,
          onBatch: () => Effect.die("must not emit"),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("supplier");
  fixture();
  await expect(
    Effect.runPromise(
      streamScottsInventoryWithRequestGate(
        {
          startCursor: opening.cursor,
          onBatch: () => Effect.fail(new Error("staging failed")),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("staging failed");
  expect(opening.cursor.phase).toBe("closing");
});

test("Scotts rejects corrupted and oversized checkpoints before transport", async () => {
  const { requested } = fixture();
  expect(() =>
    ScottsCursor.parse(" ".repeat(SCOTTS_MAX_CURSOR_BYTES + 1)),
  ).toThrow("2 MiB");
  await expect(
    Effect.runPromise(
      streamScottsInventoryWithRequestGate(
        {
          startCursor: { ...ScottsCursor.initial, checksum: "0".repeat(64) },
          onBatch: () => Effect.void,
        },
        gate,
      ),
    ),
  ).rejects.toThrow("integrity");
  expect(requested).toEqual([]);
});

test("Scotts closing rejects a make directory change before staging", async () => {
  const { pages } = fixture();
  const opening = await Effect.runPromise(
    streamScottsInventoryWithRequestGate(
      { maxPages: 4, onBatch: () => Effect.void },
      gate,
    ),
  );
  const makes = pages.get(SCOTTS_MAKES);
  if (!makes) throw new Error("Make directory fixture missing");
  pages.set(
    SCOTTS_MAKES,
    makes.replace(
      '<span class="aps-make-link__count">800</span>',
      '<span class="aps-make-link__count">801</span>',
    ),
  );
  await expect(
    Effect.runPromise(
      streamScottsInventoryWithRequestGate(
        {
          startCursor: opening.cursor,
          onBatch: () => Effect.die("Changed catalog must not emit"),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("make graph changed");
});

test("Scotts completes a full crawl when every request waits two minutes for a shared host turn", async () => {
  // Production URG queue on 2026-11-19: about 20 sources shared one lease, so
  // each request waited about two minutes for its turn.
  const { requested } = fixture();
  let cursor: Cursor = ScottsCursor.initial;
  const pages: number[] = [];
  let count = 0;
  while (cursor.phase !== "complete") {
    const chunk = await runWithQueuedHost(
      streamScottsInventory({
        startCursor: cursor,
        maxPages: 6,
        onBatch: () => Effect.void,
      }),
      { turnWaitMs: 2 * 60_000 },
    );
    if (Either.isLeft(chunk.result)) throw chunk.result.left;
    const result: ScottsStreamResult = chunk.result.right;
    pages.push(result.pagesProcessed);
    count = result.count;
    cursor = ScottsCursor.parse(ScottsCursor.serialize(result.cursor));
    // Every chunk returns its checkpoint and releases each lease in time.
    expect(result.pagesProcessed).toBeGreaterThan(0);
    expect(chunk.elapsedMs).toBeLessThanOrEqual(6 * 60_000);
    expect(chunk.turns.every((turn) => turn.releasedAt !== null)).toBe(true);
  }
  expect(pages).toEqual([2, 2, 2]);
  expect(count).toBe(800);
  expect(requested).toHaveLength(6);
}, 120_000);

/** Drops the first donor card from a fixture model page. */
const dropFirstCard = (body: string) =>
  body.replace(/<div class="aps-la-card-wrapper">[\s\S]*?<\/div><\/div>/, "");

test("Scotts confirms a model read with fewer cards than its badge at closing", async () => {
  const { pages, requested } = fixture();
  const modelUrl = SCOTTS_ORIGIN + "/used-parts/ACURA/CL";
  const page = pages.get(modelUrl);
  if (!page) throw new Error("Model fixture missing");
  // The badge promises 800 donors; the page lists 799.
  pages.set(modelUrl, dropFirstCard(page));
  let cursor: Cursor = ScottsCursor.initial;
  let count = 0;
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamScottsInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages: 6,
          onBatch: (batch) =>
            Effect.sync(() => {
              count += batch.length;
            }),
        },
        gate,
      ),
    );
    cursor = ScottsCursor.parse(ScottsCursor.serialize(result.cursor));
  }
  expect(count).toBe(799);
  // Opening root, makes, menu and model; closing root, makes and the model.
  expect(requested).toHaveLength(7);
  expect(requested.filter((url) => url === modelUrl)).toHaveLength(2);
});

test("Scotts fails without callbacks when a short model page changes at closing", async () => {
  const { pages, requested } = fixture();
  const modelUrl = SCOTTS_ORIGIN + "/used-parts/ACURA/CL";
  const page = pages.get(modelUrl);
  if (!page) throw new Error("Model fixture missing");
  const short = dropFirstCard(page);
  pages.set(modelUrl, short);
  const opening = await Effect.runPromise(
    streamScottsInventoryWithRequestGate(
      { maxPages: 4, onBatch: () => Effect.die("must not emit") },
      gate,
    ),
  );
  expect(opening.cursor.phase).toBe("closing");
  // A short page that does not repeat at closing is never accepted.
  pages.set(modelUrl, dropFirstCard(short));
  await expect(
    Effect.runPromise(
      streamScottsInventoryWithRequestGate(
        {
          startCursor: opening.cursor,
          onBatch: () => Effect.die("must not emit"),
          onYards: () => Effect.die("must not emit"),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("Closing Scotts model cards for ACURA CL changed");
  expect(requested).toHaveLength(7);
});

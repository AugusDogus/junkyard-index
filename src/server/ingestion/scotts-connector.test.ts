import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  ScottsCursor,
  SCOTTS_MAX_CURSOR_BYTES,
  type ScottsCursor as Cursor,
} from "./scotts-cursor";
import { streamScottsInventoryWithRequestGate } from "./scotts-connector";
import type { ScottsCanonicalVehicle } from "./scotts-transform";
import {
  SCOTTS_MAKES,
  SCOTTS_ORIGIN,
  SCOTTS_ROOT,
} from "./scotts-yard-metadata";

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
  expect(requested).toHaveLength(8);
  await Effect.runPromise(
    streamScottsInventoryWithRequestGate(
      {
        startCursor: cursor,
        onBatch: () => Effect.die("terminal replay emitted"),
      },
      gate,
    ),
  );
  expect(requested).toHaveLength(8);
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

test("Scotts closing rejects a stable-count membership change before staging", async () => {
  const { pages } = fixture();
  const opening = await Effect.runPromise(
    streamScottsInventoryWithRequestGate(
      { maxPages: 4, onBatch: () => Effect.void },
      gate,
    ),
  );
  const url = SCOTTS_ORIGIN + "/used-parts/ACURA/CL";
  const originalPage = pages.get(url);
  if (!originalPage) throw new Error("Model fixture missing");
  pages.set(
    url,
    originalPage.replace("1HGCM82633A000000", "1HGCM82633A999999"),
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
  ).rejects.toThrow("model cards changed");
});

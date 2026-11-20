import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamScottsInventoryWithRequestGate } from "./scotts-connector";
import { ScottsCursor, ScottsCursorSchema } from "./scotts-cursor";
import {
  SCOTTS_MAKES,
  SCOTTS_ORIGIN,
  SCOTTS_ROOT,
} from "./scotts-yard-metadata";
import { MODEL_CENSUS_DAY_MS } from "./model-census";
import { scottsHash } from "./scotts-parser";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const document = (body: string) =>
  `<html><body><h1>Scott's Used Parts</h1><a href="tel:9704980662">Call</a><p>938 West Willox Lane, Fort Collins, Colorado 80524. Scott's Used Parts is a full-service supplier of salvaged and used auto parts</p><script>var urgid = 'CC68,XX00'; var apsFrontend = {"makesBrowseUrl":"${SCOTTS_MAKES}#aps-search-by-makes"};</script>${body}</body></html>`;
const link = (kind: "make" | "model", path: string, label: string, n: number) =>
  `<a class="aps-${kind}-link" href="${SCOTTS_ORIGIN + path}"><span class="aps-make-link__label">${label}</span><span class="aps-make-link__count">${n}</span></a>`;
const label = (model: number) => "M" + model;
const vin = (model: number, n: number) =>
  "1HGCM82633A" + String(model * 1000 + n).padStart(6, "0");
const card = (model: number, n: number) =>
  `<div class="aps-la-card-wrapper"><div class="aps-la-card-premium" id="T${model}-${n}"><a class="aps-la-card-link-premium" href="${SCOTTS_ORIGIN}/used-parts/ACURA/${label(model)}/T${model}-${n}/2003"><h3 class="aps-la-title-premium">ACURA ${label(model)}</h3><p class="aps-la-subtitle-premium--vin">VIN: ${vin(model, n)}</p><div class="aps-la-right-val-premium"><span>Year</span>2003</div></a></div></div>`;
const donors = (n = 30) => Array.from({ length: n }, (_, i) => i + 1);

/** Twelve ACURA models with 30 donors each (above the 325 floor); `rows` holds
 * each model's donor numbers and can be edited between runs. */
function yard() {
  const rows = new Map(Array.from({ length: 12 }, (_, i) => [i, donors()]));
  const urls: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      urls.push(url);
      const total = [...rows.values()].reduce((n, l) => n + l.length, 0);
      const model = /\/used-parts\/ACURA\/M(\d+)$/.exec(url);
      const index = Number(model?.[1]);
      const list = rows.get(index);
      const body =
        url === SCOTTS_ROOT
          ? document("")
          : url === SCOTTS_MAKES
            ? document(link("make", "/used-parts/ACURA", "ACURA", total))
            : url === SCOTTS_ORIGIN + "/used-parts/ACURA"
              ? document(
                  [...rows]
                    .map(([i, l]) =>
                      link(
                        "model",
                        "/used-parts/ACURA/" + label(i),
                        label(i),
                        l.length,
                      ),
                    )
                    .join(""),
                )
              : model && list
                ? document(
                    `<h1>Used ACURA ${label(index)}</h1><p>Some vehicles may not show parts available if we haven't parted them out yet.</p><div class="aps-la-grid">${list.map((n) => card(index, n)).join("")}</div>`,
                  )
                : undefined;
      if (body === undefined) throw new Error("Unexpected request " + url);
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
    { preconnect: originalFetch.preconnect },
  );
  return { rows, urls };
}

/** One full run on `day`, seeded by the previous terminal cursor. */
async function census(
  native: ReturnType<typeof yard>,
  day: number,
  previousCursor: unknown,
) {
  const before = native.urls.length;
  let cursor: ScottsCursor = ScottsCursor.initial;
  const vins: string[] = [];
  const warnings: string[] = [];
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamScottsInventoryWithRequestGate(
        {
          startCursor: cursor,
          // Only the first chunk may adopt a census; later chunks must not.
          previousCursor,
          now: () => day * MODEL_CENSUS_DAY_MS + 7 * 60 * 60 * 1000,
          maxPages: 3,
          onBatch: (batch) =>
            Effect.sync(() => {
              vins.push(...batch.map((v) => v.vin));
            }),
        },
        gate,
      ),
    );
    warnings.push(...result.warnings);
    cursor = ScottsCursor.parse(ScottsCursor.serialize(result.cursor));
  }
  const terminal: unknown = JSON.parse(ScottsCursor.serialize(cursor));
  return {
    terminal,
    requests: native.urls.length - before,
    models: native.urls
      .slice(before)
      .flatMap((url) => /\/used-parts\/ACURA\/M(\d+)$/.exec(url)?.[1] ?? [])
      .map(Number),
    vins: vins.sort(),
    warnings,
  };
}

const allVins = (native: ReturnType<typeof yard>) =>
  [...native.rows]
    .flatMap(([model, list]) => list.map((n) => vin(model, n)))
    .sort();

test("Scotts cold start reads every model and publishes its census", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  expect(cold.models).toEqual(Array.from({ length: 12 }, (_, i) => i));
  // root, makes, one menu, 12 models, closing root and makes.
  expect(cold.requests).toBe(17);
  expect(cold.vins).toEqual(allVins(native));
  expect(cold.warnings).toHaveLength(2);
  expect(cold.warnings.at(-1)).toBe(
    "Scotts Read 12 of 12 model pages (cold 12); carried 0.",
  );
});

test("Scotts carries unread models, rotates the sweep and reads count changes", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // Day 601: only the sweep slice (ordinal % 6 === 601 % 6) is read.
  const next = await census(native, 601, cold.terminal);
  expect(next.models).toEqual([1, 7]);
  expect(next.requests).toBe(7);
  // Carried donors are still published in full.
  expect(next.vins).toEqual(allVins(native));
  expect(next.warnings.at(-1)).toBe(
    "Scotts Read 2 of 12 model pages (sweep 2); carried 10.",
  );

  // Day 602: a sold donor changes model 4's badge, and model 9 gains one.
  native.rows.set(4, donors(29));
  native.rows.set(9, [...donors(), 31]);
  const changed = await census(native, 602, next.terminal);
  expect(changed.models).toEqual([2, 4, 8, 9]);
  expect(changed.vins).toEqual(allVins(native));
  expect(changed.warnings.at(-1)).toBe(
    "Scotts Read 4 of 12 model pages (sweep 2, count 2); carried 8.",
  );
});

test("Scotts re-reads every model within six days, even across missed runs", async () => {
  const native = yard();
  let previous = (await census(native, 600, null)).terminal;
  const lastRead = new Map<number, number>();
  for (let i = 0; i < 12; i++) lastRead.set(i, 600);
  // Skip days 601 and 602 entirely, then run daily.
  for (const day of [603, 604, 605, 606, 607, 608, 609, 610, 611, 612]) {
    const run = await census(native, day, previous);
    for (const model of run.models) lastRead.set(model, day);
    for (const read of lastRead.values()) expect(day - read).toBeLessThan(6);
    // About a sixth of the models per day once caught up.
    if (day > 606) expect(run.models).toHaveLength(2);
    expect(run.vins).toEqual(allVins(native));
    previous = run.terminal;
  }
});

test("Scotts reads every model with a warning when the previous cursor is unusable", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const parsed = ScottsCursorSchema.parse(cold.terminal);
  if (parsed.phase !== "complete" || !parsed.census)
    throw new Error("Expected a terminal census");
  const { census: published } = parsed;

  const junk = await census(native, 601, { source: "scotts", junk: true });
  expect(junk.models).toHaveLength(12);
  expect(junk.warnings[0]).toBe(
    "Previous Scotts checkpoint is not a readable terminal census; reading every model page.",
  );

  const foreign = await census(native, 601, {
    ...parsed,
    census: { ...published, contract: "older-contract" },
  });
  expect(foreign.models).toHaveLength(12);
  expect(foreign.warnings[0]).toContain("another parser or traversal contract");

  const future = await census(native, 599, cold.terminal);
  expect(future.models).toHaveLength(12);
  expect(future.warnings[0]).toContain("dated after this run");

  // A carried page whose cards no longer match their fingerprint is not a census.
  const [first, ...rest] = published.models;
  if (!first) throw new Error("Expected census evidence");
  const tampered = await census(native, 601, {
    ...parsed,
    census: {
      ...published,
      models: [
        {
          ...first,
          page: { ...first.page, records: first.page.records.slice(1) },
        },
        ...rest,
      ],
    },
  });
  expect(tampered.models).toHaveLength(12);
  expect(tampered.warnings[0]).toContain("not a readable terminal census");

  // A pre-incremental terminal cursor is a silent cold start.
  const legacy = await census(native, 601, {
    source: "scotts",
    version: 1,
    phase: "complete",
  });
  expect(legacy.models).toHaveLength(12);
  expect(legacy.warnings).toHaveLength(2);
});

test("Scotts rejects checkpoints whose carried pages or request accounting were altered", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const day = 601;
  // Root, makes and the menu: the menu step carries models 0 and stops at 1.
  const opening = await Effect.runPromise(
    streamScottsInventoryWithRequestGate(
      {
        previousCursor: cold.terminal,
        now: () => day * MODEL_CENSUS_DAY_MS,
        maxPages: 3,
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  const cursor = opening.cursor;
  if (cursor.phase !== "models") throw new Error("Expected the model phase");
  expect(cursor.pages).toHaveLength(1);
  expect(cursor.requests).toBe(3);
  const [carried] = cursor.pages;
  if (!carried) throw new Error("Expected a carried page");
  expect(() =>
    ScottsCursor.checkpoint({
      ...cursor,
      pages: [{ records: [], hash: carried.hash }],
    }),
  ).toThrow("fingerprint");
  // A self-consistent page that differs from the census evidence.
  const edited = carried.records.slice(1);
  expect(() =>
    ScottsCursor.checkpoint({
      ...cursor,
      pages: [{ records: edited, hash: scottsHash(edited) }],
    }),
  ).toThrow("carried model page differs from its census");
  // Charging a GET for a carried page breaks request accounting.
  expect(() => ScottsCursor.checkpoint({ ...cursor, requests: 4 })).toThrow(
    "request accounting",
  );
  // Stopping on a carried model would read a page the plan does not need.
  expect(() =>
    ScottsCursor.checkpoint({ ...cursor, pages: [], requests: 3 }),
  ).toThrow("not due for a read");
  // The run day cannot move before the adopted census.
  expect(() => ScottsCursor.checkpoint({ ...cursor, day: 599 })).toThrow(
    "previous census is inconsistent",
  );
  expect(native.urls).toHaveLength(cold.requests + 3);
});

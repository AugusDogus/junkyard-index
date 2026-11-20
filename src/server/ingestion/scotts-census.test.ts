import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  streamScottsInventoryWithRequestGate,
  type ScottsStreamResult,
} from "./scotts-connector";
import {
  ScottsCursor,
  ScottsCursorSchema,
  SCOTTS_MINIMUM_BADGE_COVERAGE,
} from "./scotts-cursor";
import {
  SCOTTS_MAKES,
  SCOTTS_ORIGIN,
  SCOTTS_ROOT,
} from "./scotts-yard-metadata";
import {
  MODEL_CENSUS_DAY_MS,
  MODEL_CENSUS_REPLAY_MINIMUM,
  MODEL_CENSUS_SWEEP_DAYS,
  ModelCensus,
} from "./model-census";
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
/** The VIN-less NOF placeholder card six real Scotts models list after their
 * donors; badges never count it. */
const placeholder = (model: number) =>
  `<div class="aps-la-card-wrapper"><div class="aps-la-card-premium" id="NOF"><a class="aps-la-card-link-premium" href="${SCOTTS_ORIGIN}/used-parts/ACURA/${label(model)}/NOF/2013"><h3 class="aps-la-title-premium">ACURA ${label(model)}</h3><p class="aps-la-subtitle-premium--vin">VIN: -</p><div class="aps-la-right-val-premium"><span>Year</span>2013</div></a></div></div>`;
const donors = (n = 30) => Array.from({ length: n }, (_, i) => i + 1);

/** Twelve ACURA models with 30 donors each (above the 325 floor); `rows` holds
 * each model's donor numbers, `badges` overrides a model's published count, a
 * `broken` model's page lists only its first donor while the menus still count
 * them all, and a `placeholders` model's page also lists an NOF card. All can
 * be edited between runs. */
function yard() {
  const rows = new Map(Array.from({ length: 12 }, (_, i) => [i, donors()]));
  const badges = new Map<number, number>();
  const broken = new Set<number>();
  const placeholders = new Set<number>();
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
      const listed = rows.get(index);
      const list = broken.has(index) ? listed?.slice(0, 1) : listed;
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
                        badges.get(i) ?? l.length,
                      ),
                    )
                    .join(""),
                )
              : model && list
                ? document(
                    `<h1>Used ACURA ${label(index)}</h1><p>Some vehicles may not show parts available if we haven't parted them out yet.</p><div class="aps-la-grid">${list.map((n) => card(index, n)).join("")}${placeholders.has(index) ? placeholder(index) : ""}</div>`,
                  )
                : undefined;
      if (body === undefined) throw new Error("Unexpected request " + url);
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
    { preconnect: originalFetch.preconnect },
  );
  return { rows, badges, broken, placeholders, urls };
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

/** The census key Scotts builds for a fixture model (make path and label plus
 * model path and label). */
const key = (model: number) =>
  JSON.stringify([
    "/used-parts/ACURA",
    "ACURA",
    "/used-parts/ACURA/" + label(model),
    label(model),
  ]);
/** Models in `day`'s sweep slice, in published order. */
const sweep = (native: ReturnType<typeof yard>, day: number) =>
  [...native.rows.keys()].filter(
    (model) => ModelCensus.slice(key(model)) === day % MODEL_CENSUS_SWEEP_DAYS,
  );
/** Days after `from`, inside the age ceiling, whose sweep slice is not empty. */
const sweepDays = (native: ReturnType<typeof yard>, from: number) =>
  Array.from(
    { length: MODEL_CENSUS_SWEEP_DAYS - 1 },
    (_, i) => from + 1 + i,
  ).filter((day) => sweep(native, day).length > 0);

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
  // The test's sweep slices are computed from the keys the connector publishes.
  const parsed = ScottsCursorSchema.parse(cold.terminal);
  if (parsed.phase !== "complete" || !parsed.census)
    throw new Error("Expected a terminal census");
  expect(parsed.census.models.map((m) => m.key)).toEqual(
    Array.from({ length: 12 }, (_, i) => key(i)),
  );
});

test("Scotts confirms a short model page only on the run that reads it", async () => {
  const native = yard();
  // Model 3's badge promises one more donor than its page lists.
  native.badges.set(3, 31);
  const cold = await census(native, 600, null);
  // Model 3 is read once in the model phase and once more at closing.
  expect(cold.models).toEqual([...Array.from({ length: 12 }, (_, i) => i), 3]);
  expect(cold.requests).toBe(18);
  expect(cold.vins).toEqual(allVins(native));

  // A carried short page was confirmed on the run that read it.
  const day = sweepDays(native, 600).find(
    (candidate) => !sweep(native, candidate).includes(3),
  );
  if (day === undefined)
    throw new Error("Fixture needs a sweep day without M3");
  const carried = await census(native, day, cold.terminal);
  expect(carried.models).toEqual(sweep(native, day));
  expect(carried.requests).toBe(5 + sweep(native, day).length);
  expect(carried.vins).toEqual(allVins(native));
});

test("Scotts carries unread models, rotates the sweep and reads count changes", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // Two later days with non-empty, distinct sweep slices, both before any
  // model reaches the age ceiling.
  const [first, second] = sweepDays(native, 600);
  if (first === undefined || second === undefined)
    throw new Error("Fixture needs two non-empty sweep days");
  const firstSweep = sweep(native, first);
  const secondSweep = sweep(native, second);
  expect(firstSweep.some((model) => secondSweep.includes(model))).toBe(false);

  // Only the first day's sweep slice is read.
  const next = await census(native, first, cold.terminal);
  expect(next.models).toEqual(firstSweep);
  expect(next.requests).toBe(5 + firstSweep.length);
  // Carried donors are still published in full.
  expect(next.vins).toEqual(allVins(native));
  expect(next.warnings.at(-1)).toBe(
    `Scotts Read ${firstSweep.length} of 12 model pages (sweep ${firstSweep.length}); carried ${12 - firstSweep.length}.`,
  );

  // A sold donor changes one badge and another model gains a donor; both sit
  // outside the second day's slice so only their count change reads them.
  const [sold, gained] = [...native.rows.keys()].filter(
    (model) => !secondSweep.includes(model),
  );
  if (sold === undefined || gained === undefined)
    throw new Error("Fixture needs two models outside the sweep slice");
  native.rows.set(sold, donors(29));
  native.rows.set(gained, [...donors(), 31]);
  const changed = await census(native, second, next.terminal);
  expect(changed.models).toEqual(
    [...secondSweep, sold, gained].sort((a, b) => a - b),
  );
  expect(changed.vins).toEqual(allVins(native));
  // The summary lists reasons in the order their first model is published.
  const reasons = [
    { model: Math.min(...secondSweep), text: `sweep ${secondSweep.length}` },
    { model: Math.min(sold, gained), text: "count 2" },
  ]
    .sort((a, b) => a.model - b.model)
    .map((reason) => reason.text)
    .join(", ");
  expect(changed.warnings.at(-1)).toBe(
    `Scotts Read ${secondSweep.length + 2} of 12 model pages (${reasons}); carried ${10 - secondSweep.length}.`,
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
    // Once caught up, each day reads exactly its sweep slice.
    if (day > 606) expect(run.models).toEqual(sweep(native, day));
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
  // A day whose first read is not model 0, so the menu step carries a page.
  const day = sweepDays(native, 600).find(
    (candidate) => (sweep(native, candidate)[0] ?? 0) > 0,
  );
  const firstRead = day === undefined ? undefined : sweep(native, day)[0];
  if (day === undefined || firstRead === undefined)
    throw new Error("Fixture needs a sweep day that carries model 0");
  // Root, makes and the menu: the menu step carries every model before the
  // first read and stops there.
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
  expect(cursor.pages).toHaveLength(firstRead);
  expect(cursor.requests).toBe(3);
  const [carried, ...carriedRest] = cursor.pages;
  if (!carried) throw new Error("Expected a carried page");
  expect(() =>
    ScottsCursor.checkpoint({
      ...cursor,
      pages: [{ records: [], hash: carried.hash }, ...carriedRest],
    }),
  ).toThrow("fingerprint");
  // A self-consistent page that differs from the census evidence.
  const edited = carried.records.slice(1);
  expect(() =>
    ScottsCursor.checkpoint({
      ...cursor,
      pages: [{ records: edited, hash: scottsHash(edited) }, ...carriedRest],
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

test("Scotts stores closing-confirmed short pages as confirmed and carries surplus pages as full", async () => {
  const native = yard();
  // Model 3's badge promises one more donor than its page lists; model 5 lists
  // one card more than its badge, as NOF placeholder cards do on Scotts.
  native.badges.set(3, 31);
  native.badges.set(5, 29);
  const cold = await census(native, 600, null);
  // Closing re-reads both mismatched pages read this run.
  expect(cold.models).toEqual([
    ...Array.from({ length: 12 }, (_, i) => i),
    3,
    5,
  ]);
  const parsed = ScottsCursorSchema.parse(cold.terminal);
  if (parsed.phase !== "complete" || !parsed.census)
    throw new Error("Expected a terminal census");
  expect(parsed.census.models.map((m) => m.confirmed)).toEqual(
    Array.from({ length: 12 }, (_, i) => i === 3),
  );

  // Neither page is read again as short on a day whose slice skips both.
  const day = sweepDays(native, 600).find(
    (candidate) =>
      !sweep(native, candidate).includes(3) &&
      !sweep(native, candidate).includes(5),
  );
  if (day === undefined)
    throw new Error("Fixture needs a sweep day without M3 and M5");
  const carried = await census(native, day, cold.terminal);
  expect(carried.models).toEqual(sweep(native, day));
  expect(carried.vins).toEqual(allVins(native));
  expect(carried.warnings.at(-1)).not.toContain("short");
});

test("Scotts fails a run whose read and carried cards fall short of today's model badges", async () => {
  // A site fault cuts model pages to one card while the menus keep counting
  // every donor. Carried pages hide it from the 325 floor, because only today's
  // sweep slice breaks, so the badge coverage check must catch it.
  const native = yard();
  for (const model of native.rows.keys()) native.rows.set(model, donors(60));
  const cold = await census(native, 600, null);
  const day = sweepDays(native, 600)[0];
  if (day === undefined) throw new Error("Fixture needs a non-empty slice");
  const slice = sweep(native, day);
  for (const model of slice) native.broken.add(model);
  // The accepted donors left would still clear the 325 floor.
  expect(12 * 60 - slice.length * 59).toBeGreaterThanOrEqual(325);
  let published = 0;
  let yards = 0;
  await expect(
    (async () => {
      let cursor: ScottsCursor = ScottsCursor.initial;
      while (cursor.phase !== "complete") {
        const result: ScottsStreamResult = await Effect.runPromise(
          streamScottsInventoryWithRequestGate(
            {
              startCursor: cursor,
              previousCursor: cold.terminal,
              now: () => day * MODEL_CENSUS_DAY_MS,
              onBatch: (batch) =>
                Effect.sync(() => {
                  published += batch.length;
                }),
              onYards: (list) =>
                Effect.sync(() => {
                  yards += list.length;
                }),
            },
            gate,
          ),
        );
        cursor = result.cursor;
      }
    })(),
  ).rejects.toThrow("coverage floor");
  expect(published).toBe(0);
  expect(yards).toBe(0);
});

/** Runs `day` to completion and returns the error that stopped it, with what
 * reached the inventory and yard callbacks. */
async function failedRun(day: number, previousCursor: unknown) {
  let published = 0;
  let yards = 0;
  let cursor: ScottsCursor = ScottsCursor.initial;
  const error = await (async () => {
    while (cursor.phase !== "complete") {
      const result: ScottsStreamResult = await Effect.runPromise(
        streamScottsInventoryWithRequestGate(
          {
            startCursor: cursor,
            previousCursor,
            now: () => day * MODEL_CENSUS_DAY_MS,
            onBatch: (batch) =>
              Effect.sync(() => {
                published += batch.length;
              }),
            onYards: (list) =>
              Effect.sync(() => {
                yards += list.length;
              }),
          },
          gate,
        ),
      );
      cursor = result.cursor;
    }
    return null;
  })().catch((cause: unknown) => cause);
  return {
    error: error instanceof Error ? error.message : error,
    published,
    yards,
  };
}

test("Scotts fails a sweep slice cut to one card per model even when badges still clear their floor", async () => {
  // The site cuts today's sweep slice to one card per page while the menus keep
  // counting every donor. The slice is light enough that today's badges alone
  // stay above the 95% floor, so the replay of the last accepted cards must
  // catch it.
  const native = yard();
  const day = sweepDays(native, 600)[0];
  if (day === undefined) throw new Error("Fixture needs a non-empty slice");
  const slice = sweep(native, day);
  for (const model of native.rows.keys())
    native.rows.set(model, donors(slice.includes(model) ? 28 : 60));
  const cold = await census(native, 600, null);
  const total = allVins(native).length;
  for (const model of slice) native.broken.add(model);
  const kept =
    total -
    slice.reduce(
      (n, model) => n + (native.rows.get(model)?.length ?? 1) - 1,
      0,
    );
  expect(kept).toBeGreaterThanOrEqual(
    Math.ceil(total * SCOTTS_MINIMUM_BADGE_COVERAGE),
  );
  expect(kept).toBeLessThan(Math.ceil(total * MODEL_CENSUS_REPLAY_MINIMUM));
  expect(kept).toBeGreaterThanOrEqual(325);

  const run = await failedRun(day, cold.terminal);
  expect(run.error).toContain(
    `Scotts model pages list ${kept} of ${total} cards that the last accepted census listed for models whose counts did not change, below the 97% coverage floor. Nothing was published`,
  );
  expect(run.published).toBe(0);
  expect(run.yards).toBe(0);
});

test("Scotts re-reads an NOF placeholder page that lost a donor while it still matches its badge", async () => {
  // As on the six real Scotts models with an NOF card, the badge counts three
  // donors and the healthy page lists four cards.
  const native = yard();
  const day = sweepDays(native, 600)[0];
  const model = day === undefined ? undefined : sweep(native, day)[0];
  if (day === undefined || model === undefined)
    throw new Error("Fixture needs a non-empty sweep day");
  // The next day neither sweeps the model nor reaches the age ceiling.
  expect(sweep(native, day + 1)).not.toContain(model);
  expect(day + 1 - 600).toBeLessThan(MODEL_CENSUS_SWEEP_DAYS);
  native.rows.set(model, donors(3));
  native.placeholders.add(model);
  const cold = await census(native, 600, null);
  expect(cold.vins).toEqual(allVins(native));

  // Its sweep read loses one real donor: three cards, exactly its badge.
  native.rows.set(model, donors(2));
  native.badges.set(model, 3);
  const swept = await census(native, day, cold.terminal);
  // Closing re-reads it although its cards equal its badge.
  expect(swept.models).toEqual([...sweep(native, day), model]);
  const parsed = ScottsCursorSchema.parse(swept.terminal);
  if (parsed.phase !== "complete" || !parsed.census)
    throw new Error("Expected a terminal census");
  const evidence = parsed.census.models.find((m) => m.key === key(model));
  expect(evidence?.page.records).toHaveLength(3);
  expect(evidence?.expected).toBe(4);
  expect(evidence?.confirmed).toBe(false);

  // The next run re-reads it as short instead of carrying the lost donor away.
  native.rows.set(model, donors(3));
  const next = await census(native, day + 1, swept.terminal);
  expect(next.models).toContain(model);
  expect(next.warnings.at(-1)).toContain("short 1");
  expect(next.vins).toEqual(allVins(native));
});

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
/** Every fixture model, in published order. */
const all = Array.from({ length: 12 }, (_, i) => i);
/** Run summary of an incremental run that reads every model page. */
const summary = (reasons: string) =>
  `Scotts Read 12 of 12 model pages (${reasons}); carried 0.`;
const parseCensus = (terminal: unknown) => {
  const parsed = ScottsCursorSchema.parse(terminal);
  if (parsed.phase !== "complete" || !parsed.census)
    throw new Error("Expected a terminal census");
  return parsed.census;
};

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
  // The test's evidence lookups use the keys the connector publishes.
  expect(parseCensus(cold.terminal).models.map((m) => m.key)).toEqual(
    all.map(key),
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
  // A cold run confirms no short page, even after its closing re-read.
  const coldParsed = ScottsCursorSchema.parse(cold.terminal);
  if (coldParsed.phase !== "complete" || !coldParsed.census)
    throw new Error("Expected a terminal census");
  expect(
    coldParsed.census.models.find((m) => m.key === key(3))?.confirmed,
  ).toBe(false);

  // The next incremental run reads it as short (every other page daily),
  // re-reads it at closing and confirms it.
  const confirming = await census(native, 601, cold.terminal);
  expect(confirming.models).toEqual([...all, 3]);
  // The same requests as the cold run: a full read plus one closing re-read.
  expect(confirming.requests).toBe(18);
  expect(confirming.vins).toEqual(allVins(native));
  expect(confirming.warnings.at(-1)).toBe(summary("daily 11, short 1"));
  expect(
    parseCensus(confirming.terminal).models.find((m) => m.key === key(3))
      ?.confirmed,
  ).toBe(true);

  // A confirmed short page is no longer read as short, but it is still read
  // daily. It repeats its confirmed evidence, so closing skips its re-read.
  const next = await census(native, 602, confirming.terminal);
  expect(next.models).toEqual(all);
  expect(next.requests).toBe(17);
  expect(next.vins).toEqual(allVins(native));
  expect(next.warnings.at(-1)).toBe(summary("daily 12"));
  expect(
    parseCensus(next.terminal).models.find((m) => m.key === key(3))?.confirmed,
  ).toBe(true);
});

test("Scotts reads every model page on every incremental run and reads count changes", async () => {
  const native = yard();
  const cold = await census(native, 600, null);

  // Nothing changed, yet every page is read: the request accounting matches
  // the cold run's full read and nothing is carried.
  const next = await census(native, 601, cold.terminal);
  expect(next.models).toEqual(all);
  expect(next.requests).toBe(cold.requests);
  expect(next.vins).toEqual(allVins(native));
  expect(next.warnings.at(-1)).toBe(summary("daily 12"));
  expect(parseCensus(next.terminal).models.map((m) => m.readDay)).toEqual(
    all.map(() => 601),
  );

  // A sold donor changes one badge and another model gains a donor: both are
  // read for their count change, every other page daily.
  const [sold, gained] = [4, 7];
  native.rows.set(sold, donors(29));
  native.rows.set(gained, [...donors(), 31]);
  const changed = await census(native, 602, next.terminal);
  expect(changed.models).toEqual(all);
  expect(changed.requests).toBe(cold.requests);
  expect(changed.vins).toEqual(allVins(native));
  // The summary lists reasons in the order their first model is published.
  expect(changed.warnings.at(-1)).toBe(summary("daily 10, count 2"));
});

test("Scotts publishes a donor placed under a model whose crushed donor kept its badge", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const crushed = vin(6, 5);
  const placed = vin(6, 31);
  expect(cold.vins).toContain(crushed);

  // Donor 5 is crushed and donor 31 placed under the same model on the same
  // day: the badge stays 30 and the page lists other cards.
  native.rows.set(
    6,
    [...donors(), 31].filter((n) => n !== 5),
  );
  const next = await census(native, 601, cold.terminal);
  expect(next.models).toEqual(all);
  expect(next.warnings.at(-1)).toBe(summary("daily 12"));
  expect(next.vins).toContain(placed);
  expect(next.vins).not.toContain(crushed);
  expect(next.vins).toEqual(allVins(native));
  const evidence = parseCensus(next.terminal).models.find(
    (m) => m.key === key(6),
  );
  expect(evidence?.readDay).toBe(601);
  expect(evidence?.page.records).toHaveLength(30);
});

test("Scotts reads every model on every run, even across missed runs", async () => {
  const native = yard();
  let previous = (await census(native, 600, null)).terminal;
  // Skip days 601 and 602 entirely: the gap run reads everything as a gap,
  // and each later daily run reads everything again.
  for (const day of [603, 604, 605, 606, 607, 608, 609]) {
    const run = await census(native, day, previous);
    expect(run.models).toEqual(all);
    expect(run.requests).toBe(17);
    expect(run.warnings.at(-1)).toBe(
      summary(day === 603 ? "gap 12" : "daily 12"),
    );
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

test("Scotts rejects checkpoints whose pages, request accounting or run day were altered", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const accepted = parseCensus(cold.terminal).models[0]?.page;
  if (!accepted) throw new Error("Expected census evidence");
  // Root, makes and the menu: every model page is due for a read, so the menu
  // step carries nothing and stops before the first model.
  const opening = await Effect.runPromise(
    streamScottsInventoryWithRequestGate(
      {
        previousCursor: cold.terminal,
        now: () => 601 * MODEL_CENSUS_DAY_MS,
        maxPages: 3,
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  const cursor = opening.cursor;
  if (cursor.phase !== "models") throw new Error("Expected the model phase");
  expect(cursor.pages).toHaveLength(0);
  expect(cursor.requests).toBe(3);
  // A model page in the checkpoint without the GET that read it, even one
  // copied unchanged from the last accepted census, breaks request accounting:
  // nothing is carried, so every page must have been read this run.
  expect(() =>
    ScottsCursor.checkpoint({ ...cursor, pages: [accepted] }),
  ).toThrow("request accounting");
  // Charging a GET that read no page breaks it too.
  expect(() => ScottsCursor.checkpoint({ ...cursor, requests: 4 })).toThrow(
    "request accounting",
  );
  // A read page whose cards no longer match their fingerprint.
  expect(() =>
    ScottsCursor.checkpoint({
      ...cursor,
      pages: [{ records: [], hash: accepted.hash }],
      requests: 4,
    }),
  ).toThrow("fingerprint");
  // A self-consistent page with a charged GET stands as a read page.
  const edited = accepted.records.slice(1);
  expect(
    ScottsCursor.checkpoint({
      ...cursor,
      pages: [{ records: edited, hash: scottsHash(edited) }],
      requests: 4,
    }).pages,
  ).toHaveLength(1);
  // The run day cannot move before the adopted census.
  expect(() => ScottsCursor.checkpoint({ ...cursor, day: 599 })).toThrow(
    "previous census is inconsistent",
  );
  expect(native.urls).toHaveLength(cold.requests + 3);
});

test("Scotts stores closing-confirmed short pages as confirmed and reads surplus pages as full", async () => {
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
  // A cold run confirms no short page, even after its closing re-read.
  expect(parsed.census.models.map((m) => m.confirmed)).toEqual(
    Array.from({ length: 12 }, () => false),
  );
  // Nor does it confirm the surplus it first saw: model 5 expects its extra
  // card, but the next incremental run must read it again.
  expect(parsed.census.models.map((m) => m.surplusConfirmed)).toEqual(
    Array.from({ length: 12 }, (_, i) => i !== 5),
  );
  expect(parsed.census.models[5]?.expected).toBe(30);
  expect(parsed.census.models.map((m) => m.lowSince)).toEqual(
    Array.from({ length: 12 }, () => null),
  );

  // The next incremental run reads both mismatched pages as short (every
  // other page daily) and re-reads them at closing: it stores the short page
  // as confirmed and confirms the surplus page's surplus.
  const confirming = await census(native, 601, cold.terminal);
  expect(confirming.models).toEqual([...all, 3, 5]);
  // The five non-model requests a cold run also makes (17 less its 12 model
  // pages), all 12 model pages and two closing re-reads.
  expect(confirming.requests).toBe(5 + 12 + 2);
  expect(confirming.vins).toEqual(allVins(native));
  expect(confirming.warnings.at(-1)).toBe(summary("daily 10, short 2"));
  const confirmedParsed = ScottsCursorSchema.parse(confirming.terminal);
  if (confirmedParsed.phase !== "complete" || !confirmedParsed.census)
    throw new Error("Expected a terminal census");
  expect(confirmedParsed.census.models.map((m) => m.confirmed)).toEqual(
    Array.from({ length: 12 }, (_, i) => i === 3),
  );
  expect(confirmedParsed.census.models.map((m) => m.surplusConfirmed)).toEqual(
    Array.from({ length: 12 }, () => true),
  );
  expect(confirmedParsed.census.models[5]?.expected).toBe(30);
  expect(confirmedParsed.census.models.map((m) => m.lowSince)).toEqual(
    Array.from({ length: 12 }, () => null),
  );

  // The next run reads neither page as short, only daily. Both repeat their
  // confirmed evidence, so closing re-reads neither.
  const next = await census(native, 602, confirming.terminal);
  expect(next.models).toEqual(all);
  expect(next.requests).toBe(5 + 12);
  expect(next.vins).toEqual(allVins(native));
  expect(next.warnings.at(-1)).toBe(summary("daily 12"));
});

test("Scotts fails a run whose read cards fall short of today's model badges", async () => {
  // A site fault cuts one model page to one card while the menus keep
  // counting every donor. The donors left would still clear the 325 floor, so
  // the badge coverage check must catch it.
  const native = yard();
  for (const model of native.rows.keys()) native.rows.set(model, donors(60));
  const cold = await census(native, 600, null);
  const day = 601;
  const broken = [9];
  for (const model of broken) native.broken.add(model);
  expect(12 * 60 - broken.length * 59).toBeGreaterThanOrEqual(325);
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
  ).rejects.toThrow(
    "Scotts model pages list 661 of 720 cards promised by today's model counts, below the 95% coverage floor",
  );
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

test("Scotts fails pages cut to one card each even when badges still clear their floor", async () => {
  // The site cuts a set of model pages read today to one card per page while
  // the menus keep counting every donor. The set is light enough that today's
  // badges alone stay above the 95% floor, so the replay of the last accepted
  // cards must catch it.
  const native = yard();
  const day = 601;
  const slice = [9];
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
    `Scotts model pages list ${kept} of ${total} cards that the last accepted census listed, less any drop in their counts, below the 97% coverage floor. Nothing was published`,
  );
  expect(run.published).toBe(0);
  expect(run.yards).toBe(0);
});

test("Scotts re-reads an NOF placeholder page that lost a donor while it still matches its badge", async () => {
  // As on the six real Scotts models with an NOF card, the badge counts three
  // donors and the healthy page lists four cards.
  const native = yard();
  const day = 602;
  const model = 9;
  native.rows.set(model, donors(3));
  native.placeholders.add(model);
  const cold = await census(native, 600, null);
  expect(cold.vins).toEqual(allVins(native));
  // The first incremental run confirms the surplus the cold run first saw.
  const confirmed = await census(native, 601, cold.terminal);
  expect(confirmed.warnings.at(-1)).toBe(summary("daily 11, short 1"));
  expect(
    parseCensus(confirmed.terminal).models.find((m) => m.key === key(model))
      ?.surplusConfirmed,
  ).toBe(true);

  // Its daily read loses one real donor: three cards, exactly its badge.
  native.rows.set(model, donors(2));
  native.badges.set(model, 3);
  const lost = await census(native, day, confirmed.terminal);
  // Closing re-reads it although its cards equal its badge.
  expect(lost.models).toEqual([...all, model]);
  expect(lost.warnings.at(-1)).toBe(summary("daily 12"));
  const evidence = parseCensus(lost.terminal).models.find(
    (m) => m.key === key(model),
  );
  expect(evidence?.page.records).toHaveLength(3);
  expect(evidence?.expected).toBe(4);
  expect(evidence?.confirmed).toBe(false);

  // The next run reads it as short, not merely daily, so the lost donor
  // stays an open shortfall until a read lists it again.
  native.rows.set(model, donors(3));
  const next = await census(native, day + 1, lost.terminal);
  expect(next.models).toContain(model);
  expect(next.warnings.at(-1)).toBe(summary("daily 11, short 1"));
  expect(next.vins).toEqual(allVins(native));
});

test("Scotts re-reads an NOF placeholder page that lost a donor on the day its badge changed", async () => {
  // Badge 3, healthy page 3 donors plus the NOF card. An arrival raises the
  // badge to 4 while one real donor is hidden, so the page lists 4 cards,
  // exactly its new badge.
  const native = yard();
  const day = 601;
  const quiet = 0;
  native.rows.set(quiet, donors(3));
  native.placeholders.add(quiet);
  const cold = await census(native, 600, null);
  expect(cold.vins).toEqual(allVins(native));

  native.rows.set(
    quiet,
    donors(4).filter((_, i) => i !== 1),
  );
  native.badges.set(quiet, 4);
  const changed = await census(native, day, cold.terminal);
  // Read for its count change, then re-read at closing although its cards
  // equal its new badge.
  expect(changed.models).toEqual([...all, quiet]);
  expect(changed.warnings.at(-1)).toBe(summary("count 1, daily 11"));
  const evidence = parseCensus(changed.terminal).models.find(
    (m) => m.key === key(quiet),
  );
  expect(evidence?.page.records).toHaveLength(4);
  expect(evidence?.expected).toBe(5);
  expect(evidence?.confirmed).toBe(false);

  // The next run reads it as short, not merely daily, so the hidden donor
  // stays an open shortfall until a read lists it again.
  native.rows.set(quiet, donors(4));
  const next = await census(native, day + 1, changed.terminal);
  expect(next.models).toContain(quiet);
  expect(next.warnings.at(-1)).toBe(summary("short 1, daily 11"));
  expect(next.vins).toEqual(allVins(native));
});

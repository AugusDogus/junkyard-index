import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  streamAviationInventoryWithRequestGate,
  type AviationStreamResult,
} from "./aviation-connector";
import { AviationCursor, aviationCensusPlan } from "./aviation-cursor";
import type { AviationControl, AviationRecord } from "./aviation-parser";
import {
  AVIATION_CONTACT,
  AVIATION_MAKES,
  AVIATION_ORIGIN,
  AVIATION_PARTS,
  AVIATION_ROOT,
} from "./aviation-yard-metadata";
import {
  aviationFixtureContact,
  aviationFixtureDirectory,
  aviationFixtureModelPage,
  aviationFixtureRoot,
} from "./aviation-test-fixtures";
import {
  MODEL_CENSUS_DAY_MS,
  MODEL_CENSUS_REPLAY_MINIMUM,
} from "./model-census";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const make: AviationControl = {
  path: "/used-parts/ACURA",
  label: "ACURA",
  count: 0,
};
const label = (i: number) => "M" + i;
const control = (i: number, count: number): AviationControl => ({
  path: `/used-parts/ACURA/${label(i)}`,
  label: label(i),
  count,
});
const record = (model: number, n: number): AviationRecord => [
  "1HGCM82633A" + String(model * 1000 + n).padStart(6, "0"),
  "2003",
  "ACURA " + label(model),
  "ST" + model + "-" + n,
  `/used-parts/ACURA/${label(model)}/ST${model}-${n}/2003`,
  null,
  null,
];
const donors = (model: number, n = 5) =>
  Array.from({ length: n }, (_, i) => record(model, i + 1));

/** Twelve models with five donors each (above the 20-donor floor); `rows` can
 * be edited between runs. */
function yard() {
  const rows = new Map(Array.from({ length: 12 }, (_, i) => [i, donors(i)]));
  // Models whose page renders only its first card while the menus still count
  // every donor (an empty list fails the parser on its own).
  const short = new Set<number>();
  // Menu counts that differ from the listed cards, as on 32 live models.
  const badges = new Map<number, number>();
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
      const makes = aviationFixtureDirectory(
        [{ ...make, count: total }],
        "makes",
      );
      const model = /\/used-parts\/ACURA\/M(\d+)$/.exec(url);
      const body =
        url === AVIATION_CONTACT
          ? aviationFixtureContact
          : url === AVIATION_ROOT
            ? // Arrivals always list a card; this donor is already on M0.
              aviationFixtureRoot([record(0, 1)])
            : url === AVIATION_PARTS || url === AVIATION_MAKES
              ? makes
              : url === AVIATION_ORIGIN + make.path
                ? aviationFixtureDirectory(
                    [...rows].map(([i, list]) =>
                      control(i, badges.get(i) ?? list.length),
                    ),
                    "models",
                  )
                : model
                  ? aviationFixtureModelPage(
                      (rows.get(Number(model[1])) ?? []).slice(
                        0,
                        short.has(Number(model[1])) ? 1 : undefined,
                      ),
                      control(Number(model[1]), 0),
                    )
                  : undefined;
      if (body === undefined) throw new Error("Unexpected request " + url);
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  return { rows, short, badges, urls };
}

const at = (day: number) => () => day * MODEL_CENSUS_DAY_MS + 7 * 60 * 60_000;

/** One full run on `day`, seeded by the previous terminal cursor. */
async function census(
  native: ReturnType<typeof yard>,
  day: number,
  previousCursor: unknown,
) {
  const before = native.urls.length;
  let cursor: AviationCursor = AviationCursor.initial;
  const vins: string[] = [];
  const warnings: string[] = [];
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamAviationInventoryWithRequestGate(
        {
          startCursor: cursor,
          // Only the first chunk may adopt a census; later chunks must not.
          previousCursor,
          now: at(day),
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
    cursor = AviationCursor.parse(AviationCursor.serialize(result.cursor));
  }
  const models = native.urls
    .slice(before)
    .flatMap((url) => /\/used-parts\/ACURA\/M(\d+)$/.exec(url)?.[1] ?? [])
    .map(Number);
  return {
    terminal: JSON.parse(AviationCursor.serialize(cursor)) as unknown,
    requests: native.urls.length - before,
    models,
    vins: vins.sort(),
    warnings,
  };
}

const allVins = (native: ReturnType<typeof yard>) =>
  [...native.rows.values()]
    .flat()
    .map((r) => r[0])
    .sort();
const every = Array.from({ length: 12 }, (_, i) => i);

/** The census key aviationCensusControls builds for fixture model `i`. */
const key = (i: number) =>
  JSON.stringify([make.path, make.label, control(i, 0).path, label(i)]);
/** Pages a site fault cuts to one card each: a sixth of the fixture models. */
const broken = [2, 7];

test("Aviation cold start reads every model and publishes its census", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  expect(cold.models).toEqual(every);
  // contact, root, parts, makes, one menu, 12 models, closing contact and makes.
  expect(cold.requests).toBe(19);
  expect(cold.vins).toEqual(allVins(native));
  expect(cold.warnings).toHaveLength(2);
  expect(cold.warnings.at(-1)).toBe(
    "Aviation Read 12 of 12 model pages (cold 12); carried 0.",
  );
  // A pre-incremental terminal cursor is a silent cold start.
  const legacy = await census(native, 601, {
    source: "aviation",
    version: 1,
    phase: "complete",
  });
  expect(legacy.models).toEqual(every);
  expect(legacy.warnings).toHaveLength(2);
});

test("Aviation treats unreadable or incompatible previous censuses as warned cold runs", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const terminal = cold.terminal;
  if (
    typeof terminal !== "object" ||
    terminal === null ||
    !("census" in terminal) ||
    typeof terminal.census !== "object" ||
    terminal.census === null
  )
    throw new Error("Expected a terminal census");
  const cases: [unknown, number, string][] = [
    [{ source: "aviation", junk: true }, 601, "not a readable terminal census"],
    [
      { ...terminal, census: { ...terminal.census, contract: "other" } },
      601,
      "another parser or traversal contract",
    ],
    [terminal, 599, "dated after this run"],
  ];
  for (const [previous, day, warning] of cases) {
    const run = await census(native, day, previous);
    expect(run.models).toEqual(every);
    expect(run.vins).toEqual(allVins(native));
    expect(run.warnings[0]).toContain(warning);
    expect(run.warnings[0]).toContain("reading every model page");
  }
});

test("Aviation reads every model page on every incremental run and reads changes", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // An unchanged badge proves nothing about the cards under it, so the next
  // day reads every model page again at the cost of a full read.
  const next = await census(native, 601, cold.terminal);
  expect(next.models).toEqual(every);
  expect(next.requests).toBe(cold.requests);
  expect(next.vins).toEqual(allVins(native));
  expect(next.warnings.at(-1)).toBe(
    "Aviation Read 12 of 12 model pages (daily 12); carried 0.",
  );

  // A sold donor changes model 0's published count and a new model appears;
  // every other page is still read for the day.
  native.rows.set(0, donors(0, 4));
  native.rows.set(12, donors(12));
  const changed = await census(native, 602, next.terminal);
  expect(changed.models).toEqual([...every, 12]);
  // Four opening pages, one menu, 13 models, closing contact and makes.
  expect(changed.requests).toBe(7 + 13);
  expect(changed.vins).toEqual(allVins(native));
  // Reasons are listed in the order they first occur in model order.
  expect(changed.warnings.at(-1)).toBe(
    "Aviation Read 13 of 13 model pages (count 1, daily 11, new 1); carried 0.",
  );
});

test("Aviation reads a page whose donor was crushed and replaced under the same badge", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // One donor leaves model 3 and another takes its place: the badge and the
  // model key stay the same.
  const crushed = record(3, 5);
  const placed = record(3, 6);
  native.rows.set(3, [...donors(3, 4), placed]);
  const next = await census(native, 601, cold.terminal);
  expect(next.models).toEqual(every);
  expect(next.requests).toBe(cold.requests);
  expect(next.warnings.at(-1)).toBe(
    "Aviation Read 12 of 12 model pages (daily 12); carried 0.",
  );
  expect(next.vins).toEqual(allVins(native));
  expect(next.vins).toContain(placed[0]);
  expect(next.vins).not.toContain(crushed[0]);
  // The terminal census holds today's page, not the one read on day 600.
  const terminal = AviationCursor.parse(JSON.stringify(next.terminal));
  if (terminal.phase !== "complete" || !terminal.census)
    throw new Error("Expected a terminal census");
  const evidence = terminal.census.models.find((e) => e.key === key(3));
  expect(evidence?.readDay).toBe(601);
  expect(evidence?.page.records.map((r) => r[0])).toContain(placed[0]);
  expect(evidence?.page.records.map((r) => r[0])).not.toContain(crushed[0]);
});

test("Aviation reads every model every day, including after missed runs", async () => {
  const native = yard();
  const previousRun = await census(native, 600, null);
  let previous = previousRun.terminal;
  // Skip days 601 and 602 entirely: the gap makes day 603 read every model.
  const gap = await census(native, 603, previous);
  expect(gap.models).toEqual(every);
  expect(gap.vins).toEqual(allVins(native));
  expect(gap.warnings.at(-1)).toBe(
    "Aviation Read 12 of 12 model pages (gap 12); carried 0.",
  );
  previous = gap.terminal;
  // Daily runs resume incrementally and still read every model page.
  for (const day of [604, 605, 606, 607, 608, 609, 610, 611, 612]) {
    const run = await census(native, day, previous);
    expect(run.models).toEqual(every);
    expect(run.requests).toBe(previousRun.requests);
    expect(run.warnings.at(-1)).toBe(
      "Aviation Read 12 of 12 model pages (daily 12); carried 0.",
    );
    expect(run.vins).toEqual(allVins(native));
    previous = run.terminal;
  }
});

test("Aviation checkpoints reject a model page skipped without its read", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const day = 601;
  // Opening contact, root, parts, makes and the menu; no model is carried.
  const paused = await Effect.runPromise(
    streamAviationInventoryWithRequestGate(
      {
        previousCursor: cold.terminal,
        now: at(day),
        maxPages: 5,
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  const progress = paused.cursor;
  if (progress.phase !== "models" || progress.previous === null)
    throw new Error("Expected an incremental model checkpoint");
  const previous = progress.previous;
  expect(progress.pages).toHaveLength(0);
  expect(aviationCensusPlan(progress)).toEqual(
    every.map(() => ({ kind: "read", reason: "daily" })),
  );
  // Model 0 is due for a read today; storing its last accepted page as if it
  // were carried, without the GET, is refused.
  const accepted = previous.models[0];
  if (!accepted) throw new Error("Expected census evidence for model 0");
  expect(() =>
    AviationCursor.checkpoint({
      ...progress,
      pages: [accepted.page],
    }),
  ).toThrow("request accounting");
  expect(() =>
    AviationCursor.checkpoint({ ...progress, requests: progress.requests + 1 }),
  ).toThrow("request accounting");
  expect(() =>
    AviationCursor.checkpoint({
      ...progress,
      previous: { ...previous, day: day + 1 },
    }),
  ).toThrow("run day or previous census");
  // The paused run resumes and completes without a previous cursor.
  const before = native.urls.length;
  let cursor: AviationCursor = progress;
  while (cursor.phase !== "complete") {
    const result: AviationStreamResult = await Effect.runPromise(
      streamAviationInventoryWithRequestGate(
        { startCursor: cursor, now: at(day), onBatch: () => Effect.void },
        gate,
      ),
    );
    cursor = result.cursor;
  }
  // Every model, then closing contact and makes.
  expect(native.urls.length - before).toBe(every.length + 2);
});

test("Aviation starts a warned cold census when a stored census page fails its fingerprint", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const terminal = AviationCursor.parse(JSON.stringify(cold.terminal));
  if (terminal.phase !== "complete" || !terminal.census)
    throw new Error("Expected a terminal census");
  const [first, ...rest] = terminal.census.models;
  if (!first) throw new Error("Expected census evidence");
  // Bypass the codec: a stored page whose hash no longer matches its records.
  const tampered = {
    ...terminal,
    census: {
      ...terminal.census,
      models: [{ ...first, page: { ...first.page, records: [] } }, ...rest],
    },
  };
  const next = await census(native, 600 + 1, tampered);
  expect(next.models).toHaveLength(12);
  expect(next.warnings[0]).toContain("reading every model page");
  expect(next.vins).toEqual(allVins(native));
});

/** One full run on `day` that must fail; returns its error and how many
 * callbacks ran before it. */
async function failedCensus(
  day: number,
  previousCursor: unknown,
): Promise<{ error: unknown; callbacks: number }> {
  let callbacks = 0;
  let cursor: AviationCursor = AviationCursor.initial;
  try {
    while (cursor.phase !== "complete") {
      const result: AviationStreamResult = await Effect.runPromise(
        streamAviationInventoryWithRequestGate(
          {
            startCursor: cursor,
            previousCursor,
            now: at(day),
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
      );
      cursor = result.cursor;
    }
  } catch (error) {
    return { error, callbacks };
  }
  throw new Error(`Expected the day-${day} Aviation run to fail`);
}

test("Aviation fails a run whose model cards fall short of today's model counts", async () => {
  // A site fault renders one card on a sixth of the model pages while the
  // menus look normal. Every page is read, and closing re-reads the short
  // pages identically, so only the coverage floor stops the run.
  const native = yard();
  const cold = await census(native, 600, null);
  const day = 601;
  for (const model of broken) native.short.add(model);
  const failed = await failedCensus(day, cold.terminal);
  expect(String(failed.error)).toContain("coverage floor");
  expect(String(failed.error)).toContain("promised by today's model counts");
  expect(String(failed.error)).toContain(`ACURA M${broken[0]} (4)`);
  expect(failed.callbacks).toBe(0);
  // The last accepted census stays usable once the pages recover.
  native.short.clear();
  const recovered = await census(native, day, cold.terminal);
  expect(recovered.models).toEqual(every);
  expect(recovered.warnings.at(-1)).toBe(
    "Aviation Read 12 of 12 model pages (daily 12); carried 0.",
  );
  expect(recovered.vins).toEqual(allVins(native));
});

test("Aviation surplus cards on some models never hide a shortfall on others", async () => {
  // Models outside the broken pages list five cards under a badge of two, so
  // the run's cards still exceed the badge total; each model counts only up to
  // its own badge.
  const native = yard();
  const day = 601;
  for (const model of every)
    if (!broken.includes(model)) native.badges.set(model, 2);
  // Surplus cards alone are healthy and every card is published.
  const cold = await census(native, 600, null);
  expect(cold.vins).toEqual(allVins(native));
  for (const model of broken) native.short.add(model);
  const listed = every.reduce(
    (n, i) => n + (broken.includes(i) ? 1 : (native.rows.get(i)?.length ?? 0)),
    0,
  );
  const promised = every.reduce(
    (n, i) => n + (native.badges.get(i) ?? native.rows.get(i)?.length ?? 0),
    0,
  );
  expect(listed).toBeGreaterThan(promised);
  const failed = await failedCensus(day, cold.terminal);
  expect(String(failed.error)).toContain("coverage floor");
  expect(failed.callbacks).toBe(0);
});

test("Aviation fails a run whose pages are cut to one card each even while the badge floor holds", async () => {
  // Models outside the broken pages list enough donors that one card per
  // broken page still leaves at least 95% of today's badges; the menus keep
  // counting every donor. Only the replay of last accepted cards catches it.
  const native = yard();
  const day = 601;
  const outside = Math.ceil((95 * broken.length) / (12 - broken.length));
  for (const model of every)
    if (!broken.includes(model)) native.rows.set(model, donors(model, outside));
  const cold = await census(native, 600, null);
  expect(cold.vins).toEqual(allVins(native));
  for (const model of broken) native.short.add(model);
  const total = every.reduce(
    (n, i) => n + (native.rows.get(i)?.length ?? 0),
    0,
  );
  const listed = total - broken.length * 4;
  expect(listed / total).toBeGreaterThanOrEqual(0.95);
  expect(listed / total).toBeLessThan(MODEL_CENSUS_REPLAY_MINIMUM);
  const failed = await failedCensus(day, cold.terminal);
  expect(String(failed.error)).toContain("coverage floor");
  expect(String(failed.error)).toContain(
    "that the last accepted census listed, less any drop in their counts",
  );
  expect(String(failed.error)).toContain(`ACURA M${broken[0]} (4)`);
  expect(failed.callbacks).toBe(0);
});

test("Aviation re-reads a surplus page that a daily read cut to its badge", async () => {
  // Model m's badge counts four donors while its healthy page lists five, as on
  // 32 live models. A read that loses one real donor lists exactly the badge,
  // so the page must not be stored as healthy.
  const native = yard();
  const day = 601;
  const m = 3;
  native.badges.set(m, 4);
  const cold = await census(native, 600, null);
  expect(cold.vins).toEqual(allVins(native));
  const healthy = native.rows.get(m) ?? [];
  native.rows.set(m, healthy.slice(0, 4));
  const dropped = await census(native, day, cold.terminal);
  // The daily read and closing's confirmation re-read of the cut page.
  expect(dropped.models.filter((i) => i === m)).toHaveLength(2);
  const terminal = AviationCursor.parse(JSON.stringify(dropped.terminal));
  if (terminal.phase !== "complete" || !terminal.census)
    throw new Error("Expected a terminal census");
  const evidence = terminal.census.models.find((e) => e.key === key(m));
  expect(evidence?.expected).toBe(5);
  expect(evidence?.confirmed).toBe(false);
  // The donor was transiently missing; the next run reads m as short (and
  // closing re-reads it again, since it lists more than its badge).
  native.rows.set(m, healthy);
  const next = await census(native, day + 1, dropped.terminal);
  expect(next.models.filter((i) => i === m)).toHaveLength(2);
  expect(next.warnings.at(-1)).toBe(
    "Aviation Read 12 of 12 model pages (daily 11, short 1); carried 0.",
  );
  expect(next.vins).toEqual(allVins(native));
});

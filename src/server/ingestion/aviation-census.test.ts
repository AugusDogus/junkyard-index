import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  streamAviationInventoryWithRequestGate,
  type AviationStreamResult,
} from "./aviation-connector";
import { AviationCursor } from "./aviation-cursor";
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
  aviationFixturePage,
  aviationFixtureRoot,
} from "./aviation-test-fixtures";
import {
  MODEL_CENSUS_DAY_MS,
  MODEL_CENSUS_SWEEP_DAYS,
  ModelCensus,
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
/** Fixture models 0-11 in day `day`'s sweep slice, ascending. */
const sweep = (day: number) =>
  every.filter(
    (i) => ModelCensus.slice(key(i)) === day % MODEL_CENSUS_SWEEP_DAYS,
  );
/** First day after `after` whose sweep slice holds a fixture model and whose
 * lowest such model satisfies `accept`. */
function sweepDay(
  after: number,
  accept: (first: number) => boolean = () => true,
) {
  for (let day = after + 1; day <= after + MODEL_CENSUS_SWEEP_DAYS; day++) {
    const first = sweep(day)[0];
    if (first !== undefined && accept(first)) return day;
  }
  throw new Error(`No fixture sweep slice after day ${after} fits the test`);
}

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

test("Aviation carries unread models, rotates the sweep and reads changes", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // Two later days with distinct, non-empty sweep slices, both before any
  // day-600 evidence reaches the six-day ceiling.
  const first = sweepDay(600);
  const second = sweepDay(first);
  expect(second - 600).toBeLessThan(MODEL_CENSUS_SWEEP_DAYS);
  const firstSweep = sweep(first);
  const secondSweep = sweep(second);
  expect(firstSweep.length).toBeGreaterThan(0);
  expect(secondSweep.length).toBeGreaterThan(0);
  expect(secondSweep.some((i) => firstSweep.includes(i))).toBe(false);

  // Only the first day's sweep slice is read.
  const next = await census(native, first, cold.terminal);
  expect(next.models).toEqual(firstSweep);
  // Four opening pages, one menu, the sweep models, closing contact and makes.
  expect(next.requests).toBe(7 + firstSweep.length);
  // Carried donors are still published in full.
  expect(next.vins).toEqual(allVins(native));
  expect(next.warnings.at(-1)).toBe(
    `Aviation Read ${firstSweep.length} of 12 model pages (sweep ${firstSweep.length}); carried ${12 - firstSweep.length}.`,
  );

  // A sold donor changes the published count of a model outside the second
  // day's slice and a new model appears; both are read alongside that slice.
  const sold = every.find((i) => !secondSweep.includes(i));
  if (sold === undefined)
    throw new Error("Expected a model outside the second sweep slice");
  native.rows.set(sold, donors(sold, 4));
  native.rows.set(12, donors(12));
  const changed = await census(native, second, next.terminal);
  const reads = [...secondSweep, sold, 12].sort((a, b) => a - b);
  expect(changed.models).toEqual(reads);
  expect(changed.vins).toEqual(allVins(native));
  // Reasons are listed in the order they first occur in model order.
  const reasons =
    sold < (secondSweep[0] ?? Infinity)
      ? `count 1, sweep ${secondSweep.length}`
      : `sweep ${secondSweep.length}, count 1`;
  expect(changed.warnings.at(-1)).toBe(
    `Aviation Read ${reads.length} of 13 model pages (${reasons}, new 1); carried ${13 - reads.length}.`,
  );
});

test("Aviation re-reads every model within six days, even across missed runs", async () => {
  const native = yard();
  let previous = (await census(native, 600, null)).terminal;
  const lastRead = new Map<number, number>(every.map((i) => [i, 600]));
  let reads = 0;
  // Skip days 601 and 602 entirely, then run daily.
  const days = [603, 604, 605, 606, 607, 608, 609, 610, 611, 612];
  for (const day of days) {
    const run = await census(native, day, previous);
    reads += run.models.length;
    for (const model of run.models) lastRead.set(model, day);
    for (const read of lastRead.values()) expect(day - read).toBeLessThan(6);
    expect(run.vins).toEqual(allVins(native));
    previous = run.terminal;
  }
  // Steady state reads about a sixth of the models per day.
  expect(reads / days.length).toBeLessThanOrEqual(12 / 6 + 1);
});

test("Aviation checkpoints reject carried pages that differ from the census and skipped reads", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // A day whose sweep slice skips model 0, so the run opens on carried pages.
  const day = sweepDay(600, (first) => first > 0);
  const due = sweep(day);
  const firstDue = due[0];
  if (firstDue === undefined) throw new Error("Expected a non-empty sweep");
  // Opening contact, root, parts, makes and the menu; models before the first
  // due model are carried.
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
  expect(progress.pages).toHaveLength(firstDue);
  expect(() =>
    AviationCursor.checkpoint({
      ...progress,
      pages: [aviationFixturePage(donors(0, 4)), ...progress.pages.slice(1)],
    }),
  ).toThrow("carried model page differs");
  // The first due model is in today's sweep; skipping it as if carried is
  // refused.
  const carried = previous.models[firstDue];
  if (!carried)
    throw new Error(`Expected census evidence for model ${firstDue}`);
  expect(() =>
    AviationCursor.checkpoint({
      ...progress,
      pages: [...progress.pages, carried.page],
    }),
  ).toThrow("not due for a read");
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
  // The sweep models, then closing contact and makes.
  expect(native.urls.length - before).toBe(due.length + 2);
});

test("Aviation starts a warned cold census when a carried page fails its fingerprint", async () => {
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

test("Aviation fails a run whose read and carried cards fall short of today's model counts", async () => {
  // A site fault renders one card per model page while the menus look normal.
  // A full daily read would have shown it everywhere; with carried pages only
  // today's sweep slice breaks, and closing re-reads it identically.
  const native = yard();
  const cold = await census(native, 600, null);
  const day = sweepDay(600);
  const broken = sweep(day);
  for (const model of broken) native.short.add(model);
  const failed = await failedCensus(day, cold.terminal);
  expect(String(failed.error)).toContain("coverage floor");
  expect(String(failed.error)).toContain(`ACURA M${broken[0]} (4)`);
  expect(failed.callbacks).toBe(0);
  // The last accepted census stays usable once the pages recover.
  native.short.clear();
  const recovered = await census(native, day, cold.terminal);
  expect(recovered.models).toEqual(broken);
  expect(recovered.vins).toEqual(allVins(native));
});

test("Aviation surplus cards on some models never hide a shortfall on others", async () => {
  // Models outside the broken slice list five cards under a badge of two, so
  // the run's cards still exceed the badge total; each model counts only up to
  // its own badge.
  const native = yard();
  const day = sweepDay(600);
  const broken = sweep(day);
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

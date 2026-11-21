import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import { streamCaltonInventory } from "./calton-connector";
import {
  CALTON_MAKES,
  CALTON_ROOT,
  CaltonError,
  type CaltonContract,
} from "./calton-contract";
import { CaltonCursor, type CaltonCursor as Cursor } from "./calton-cursor";
import { CALTON_ORIGIN } from "./calton-html";
import {
  CALTON_EMPTY_REGION,
  caltonFixtureDocument,
} from "./calton-test-fixtures";
import {
  MODEL_CENSUS_DAY_MS,
  MODEL_CENSUS_SWEEP_DAYS,
  ModelCensus,
} from "./model-census";

const contract: CaltonContract = {
  location: {
    code: "MM28",
    name: "Calton Auto Parts Recyclers",
    city: "Elkridge",
    lat: 39.185,
    lng: -76.76,
  },
  minimumUniqueInventory: 1,
};
// Day 20,412 is a multiple of six, so day D + k sweeps the models whose census
// key hashes to slice k % 6.
const D = 20_412;
const MAKES = ["MKA", "MKB", "MKC"] as const;
const MODELS_PER_MAKE = 4;
const MODEL_COUNT = MAKES.length * MODELS_PER_MAKE;

interface Model {
  make: string;
  label: string;
  stocks: string[];
}
const modelUrl = (model: Model) =>
  `${CALTON_ORIGIN}/parts/${model.make}/${model.label}`;
const vin = (stock: string) =>
  "1HG" +
  createHash("sha256").update(stock).digest("hex").slice(0, 14).toUpperCase();
function card(model: Model, stock: string) {
  const destination = `${modelUrl(model)}/${stock}/2015`;
  return `<div id="${stock}" class="aps-la-card-premium"><a href="${destination}" class="aps-la-card-link-premium"><div class="aps-la-content-premium aps-la-car-details"><h3 class="aps-la-title-premium">${model.make} ${model.label}</h3><p class="aps-la-subtitle-premium aps-la-subtitle-premium--vin">VIN: ${vin(stock)}</p><div class="aps-la-right-val-premium"><span class="aps-la-field-label">Year</span> 2015</div><div class="aps-la-stat-premium"><div class="aps-la-stat-label">Stock</div><div class="aps-la-stat-value">${stock}</div></div></div></a></div>`;
}
/** The exact census key calton-cursor builds from the make and model controls. */
const censusKey = (model: Model) =>
  JSON.stringify([
    `/parts/${model.make}`,
    `${CALTON_ORIGIN}/parts/${model.make}`,
    model.make,
    `/parts/${model.make}/${model.label}`,
    modelUrl(model),
    model.label,
  ]);
const control = (path: string, label: string, count: number) =>
  `<a href="${CALTON_ORIGIN}${path}"><span class="aps-make-link__label">${label}</span><span class="aps-make-link__count">${count}</span></a>`;

/** A saved-shape Calton graph whose donors can change between run days. */
function yard() {
  const models: Model[] = MAKES.flatMap((make) =>
    Array.from({ length: MODELS_PER_MAKE }, (_, n) => {
      const index = MAKES.indexOf(make) * MODELS_PER_MAKE + n;
      return { make, label: "M" + n, stocks: [`S${index}A`, `S${index}B`] };
    }),
  );
  const arrival = { model: 0, stock: "S0A" };
  // Models whose page renders the native empty result, omits its last donor,
  // lists one donor beyond its badge, or lists only its first donor, while the
  // menus keep their counts.
  const broken = new Set<number>();
  const short = new Set<number>();
  const extra = new Set<number>();
  const cut = new Set<number>();
  // Menu badges that differ from the model's donors.
  const badges = new Map<number, number>();
  const document = (url: string): string | undefined => {
    if (url === CALTON_ROOT) {
      const model = models[arrival.model];
      if (!model) return undefined;
      return caltonFixtureDocument(
        `<div class="aps-la-grid">${card(model, arrival.stock)}</div>`,
        "/",
      );
    }
    if (url === CALTON_MAKES)
      return caltonFixtureDocument(
        `<div class="iisMakesMenu">${MAKES.map((make) =>
          control(
            "/parts/" + make,
            make,
            models
              .filter((m) => m.make === make)
              .reduce((sum, m) => sum + m.stocks.length, 0),
          ),
        ).join("")}</div>`,
        "/parts/",
      );
    const make = MAKES.find((m) => url === `${CALTON_ORIGIN}/parts/${m}`);
    if (make)
      return caltonFixtureDocument(
        `<div id="menumodellist">${models
          .filter((m) => m.make === make)
          .map((m) =>
            control(
              `/parts/${m.make}/${m.label}`,
              m.label,
              badges.get(models.indexOf(m)) ?? m.stocks.length,
            ),
          )
          .join("")}</div>`,
        "/parts/" + make,
      );
    const index = models.findIndex((m) => modelUrl(m) === url);
    const model = models[index];
    if (!model) return undefined;
    const path = `/parts/${model.make}/${model.label}`;
    if (broken.has(index))
      return caltonFixtureDocument(CALTON_EMPTY_REGION, path);
    const stocks = short.has(index)
      ? model.stocks.slice(0, -1)
      : cut.has(index)
        ? model.stocks.slice(0, 1)
        : extra.has(index)
          ? [...model.stocks, `S${index}X`]
          : model.stocks;
    return caltonFixtureDocument(
      `<div id="iiscont"><div class="aps-la-grid">${stocks
        .map((stock) => card(model, stock))
        .join("")}</div></div>`,
      path,
    );
  };
  return { models, arrival, broken, short, extra, cut, badges, document };
}
type Yard = ReturnType<typeof yard>;

/** One daily pass in eight-request chunks, resuming from each paused cursor.
 * Published VINs land in `published`, so a caller can inspect a failed day. */
async function runDay(
  site: Yard,
  day: number,
  previousCursor: unknown,
  published: string[] = [],
) {
  const requests: string[] = [];
  let cursor: Cursor | undefined;
  let warnings: string[] = [];
  for (let chunk = 0; chunk < 64; chunk++) {
    const result = await Effect.runPromise(
      streamCaltonInventory({
        contract,
        previousUniqueInventory: null,
        startCursor: cursor,
        previousCursor,
        now: () => day * MODEL_CENSUS_DAY_MS + 7 * 60 * 60 * 1000,
        readPage: (url: string) => {
          requests.push(url);
          const raw = site.document(url);
          return raw === undefined
            ? Effect.fail(CaltonError.create("saved reader", "No " + url))
            : Effect.succeed(raw);
        },
        onBatch: (vehicles) =>
          Effect.sync(() => {
            published.push(...vehicles.map((vehicle) => vehicle.vin));
          }),
      }),
    );
    warnings = [...warnings, ...result.warnings];
    cursor = result.cursor;
    if (result.status === "complete") {
      // Production reads the terminal cursor back from the database as JSON.
      const terminal: unknown = JSON.parse(JSON.stringify(result.cursor));
      const modelReads = requests.filter((url) =>
        site.models.some((m) => modelUrl(m) === url),
      );
      return { requests, modelReads, published, terminal, warnings, cursor };
    }
  }
  throw new Error("Calton census day did not complete");
}
const expectedVins = (site: Yard) =>
  [...new Set(site.models.flatMap((m) => m.stocks).map(vin))].sort();
/** Published indices of the models swept on `day`, in published order. */
const sweepAt = (site: Yard, day: number) =>
  site.models.flatMap((model, index) =>
    ModelCensus.slice(censusKey(model)) === day % MODEL_CENSUS_SWEEP_DAYS
      ? [index]
      : [],
  );
/** Census summary reasons appear in the published order of their first model. */
const sweepAndOne = (
  sweep: readonly number[],
  index: number,
  reason: string,
  sweepReason = "sweep",
) =>
  (sweep[0] ?? Infinity) < index
    ? `${sweepReason} ${sweep.length}, ${reason} 1`
    : `${reason} 1, ${sweepReason} ${sweep.length}`;
const urlsAt = (site: Yard, indices: readonly number[]) =>
  indices.map((index) => {
    const model = site.models[index];
    if (!model) throw new Error("Missing test model " + index);
    return modelUrl(model);
  });

test("a cold census reads every model page and records a terminal census", async () => {
  const site = yard();
  const run = await runDay(site, D, null);
  expect(run.requests).toHaveLength(2 + MAKES.length + MODEL_COUNT);
  expect(run.modelReads).toEqual(urlsAt(site, [...Array(MODEL_COUNT).keys()]));
  expect([...run.published].sort()).toEqual(expectedVins(site));
  expect(run.warnings).toContain(
    `Calton Read ${MODEL_COUNT} of ${MODEL_COUNT} model pages (cold ${MODEL_COUNT}); carried 0.`,
  );
  if (run.cursor.phase !== "complete" || !run.cursor.census)
    throw new Error("Expected a terminal census");
  expect(run.cursor.census.day).toBe(D);
  expect(run.cursor.census.models.map((m) => m.key)).toEqual(
    site.models.map(censusKey),
  );
});

test("unread models carry their accepted pages and every donor is still published", async () => {
  const site = yard();
  const cold = await runDay(site, D, null);
  const next = await runDay(site, D + 1, cold.terminal);
  // Opening reads root, the make directory and every make menu; no closing pass.
  expect(next.requests.slice(0, 2 + MAKES.length)).toEqual([
    CALTON_ROOT,
    CALTON_MAKES,
    ...MAKES.map((make) => `${CALTON_ORIGIN}/parts/${make}`),
  ]);
  const sweep = sweepAt(site, D + 1);
  expect(sweep.length).toBeGreaterThan(0);
  expect(next.modelReads).toEqual(urlsAt(site, sweep));
  expect(next.requests).toHaveLength(2 + MAKES.length + sweep.length);
  expect([...next.published].sort()).toEqual(expectedVins(site));
  expect(next.warnings).toContain(
    `Calton Read ${sweep.length} of ${MODEL_COUNT} model pages (sweep ${sweep.length}); carried ${MODEL_COUNT - sweep.length}.`,
  );
});

test("the sweep reads a sixth of the models each day and every model within six days", async () => {
  const site = yard();
  let previous = (await runDay(site, D, null)).terminal;
  const read = new Set<string>();
  for (let offset = 1; offset <= 6; offset++) {
    const run = await runDay(site, D + offset, previous);
    const sweep = sweepAt(site, D + offset);
    expect(sweep.length).toBeGreaterThan(0);
    expect(run.modelReads).toEqual(urlsAt(site, sweep));
    expect([...run.published].sort()).toEqual(expectedVins(site));
    for (const url of run.modelReads) read.add(url);
    previous = run.terminal;
  }
  expect([...read].sort()).toEqual(
    urlsAt(site, [...Array(MODEL_COUNT).keys()]).sort(),
  );
});

test("a missed run day reads every model, then daily runs resume incrementally", async () => {
  const site = yard();
  const cold = await runDay(site, D, null);
  const daily = await runDay(site, D + 1, cold.terminal);
  expect(daily.modelReads).toEqual(urlsAt(site, sweepAt(site, D + 1)));
  // Day D + 2 is missed, so day D + 3 reads every model page again.
  const late = await runDay(site, D + 3, daily.terminal);
  expect(late.modelReads).toEqual(urlsAt(site, [...Array(MODEL_COUNT).keys()]));
  expect([...late.published].sort()).toEqual(expectedVins(site));
  expect(late.warnings).toContain(
    `Calton Read ${MODEL_COUNT} of ${MODEL_COUNT} model pages (gap ${MODEL_COUNT}); carried 0.`,
  );
  // Daily runs from D + 4 read only their sweep slice again.
  let previous = late.terminal;
  let last = late;
  for (let day = D + 4; day <= D + 8; day++) {
    const sweep = sweepAt(site, day);
    expect(sweep.length).toBeGreaterThan(0);
    const run = await runDay(site, day, previous);
    expect(run.modelReads).toEqual(urlsAt(site, sweep));
    expect([...run.published].sort()).toEqual(expectedVins(site));
    expect(run.warnings).toContain(
      `Calton Read ${sweep.length} of ${MODEL_COUNT} model pages (sweep ${sweep.length}); carried ${MODEL_COUNT - sweep.length}.`,
    );
    previous = run.terminal;
    last = run;
  }
  if (last.cursor.phase !== "complete" || !last.cursor.census)
    throw new Error("Expected a terminal census");
  for (const model of last.cursor.census.models)
    expect(D + 8 - model.readDay).toBeLessThan(6);
});

test("a changed model badge forces a read and publishes its new donor", async () => {
  const site = yard();
  const cold = await runDay(site, D, null);
  // Change a model outside today's slice so the sweep cannot mask the count.
  const sweep = sweepAt(site, D + 1);
  const changed = [...Array(MODEL_COUNT).keys()].find(
    (i) => !sweep.includes(i),
  );
  const model = changed === undefined ? undefined : site.models[changed];
  if (changed === undefined || !model) throw new Error("Missing test model");
  model.stocks.push(`S${changed}C`);
  const next = await runDay(site, D + 1, cold.terminal);
  expect(next.modelReads).toEqual(
    urlsAt(
      site,
      [...sweep, changed].sort((a, b) => a - b),
    ),
  );
  expect(next.published).toContain(vin(`S${changed}C`));
  expect(next.warnings).toContain(
    `Calton Read ${sweep.length + 1} of ${MODEL_COUNT} model pages (${sweepAndOne(sweep, changed, "count")}); carried ${MODEL_COUNT - sweep.length - 1}.`,
  );
});

test("a root arrival missing from its model's carried page triggers that read", async () => {
  const site = yard();
  const cold = await runDay(site, D, null);
  // Same-count swap: the badge alone cannot see it, the arrival can.
  // Pick a model outside today's slice (and not the cold arrival's model) so
  // the sweep cannot mask the trigger.
  const sweep = sweepAt(site, D + 1);
  const swapped = [...Array(MODEL_COUNT).keys()].find(
    (i) => i !== site.arrival.model && !sweep.includes(i),
  );
  const model = swapped === undefined ? undefined : site.models[swapped];
  if (swapped === undefined || !model) throw new Error("Missing test model");
  model.stocks = [`S${swapped}A`, `S${swapped}N`];
  site.arrival.model = swapped;
  site.arrival.stock = `S${swapped}N`;
  const next = await runDay(site, D + 1, cold.terminal);
  expect(next.modelReads).toEqual(
    urlsAt(
      site,
      [...sweep, swapped].sort((a, b) => a - b),
    ),
  );
  expect([...next.published].sort()).toEqual(expectedVins(site));
  expect(next.published).not.toContain(vin(`S${swapped}B`));
  expect(next.warnings).toContain(
    `Calton Read ${sweep.length + 1} of ${MODEL_COUNT} model pages (${sweepAndOne(sweep, swapped, "trigger")}); carried ${MODEL_COUNT - sweep.length - 1}.`,
  );
});

test("an unreadable or incompatible previous cursor is a warned cold census", async () => {
  const site = yard();
  const cold = await runDay(site, D, null);
  const foreign = CaltonCursor.initial({
    ...contract,
    location: { ...contract.location, code: "OTHER" },
  });
  if (!foreign.ok) throw new Error(foreign.error.message);
  const legacy = CaltonCursor.checkpoint(
    {
      source: "calton",
      version: 1,
      phase: "complete",
      scope: foreign.value.scope,
      requests: 679,
      bytes: 142_370_116,
    },
    { ...contract, location: { ...contract.location, code: "OTHER" } },
  );
  if (!legacy.ok) throw new Error(legacy.error.message);
  for (const previous of [
    { garbage: true },
    legacy.value,
    { ...cold.cursor, checksum: "0".repeat(64) },
  ]) {
    const run = await runDay(site, D + 1, previous);
    expect(run.modelReads).toHaveLength(MODEL_COUNT);
    expect(
      run.warnings.some((w) =>
        w.startsWith(
          "Previous Calton checkpoint is not a readable terminal census",
        ),
      ),
    ).toBe(true);
  }
  // A census dated after this run is also refused.
  const future = await runDay(site, D - 1, cold.terminal);
  expect(future.modelReads).toHaveLength(MODEL_COUNT);
  expect(future.warnings).toContain(
    "Previous model census is dated after this run; reading every model page.",
  );
  // A pre-incremental terminal cursor carries no census: silent cold start.
  const own = CaltonCursor.initial(contract);
  if (!own.ok) throw new Error(own.error.message);
  const preIncremental = CaltonCursor.checkpoint(
    {
      source: "calton",
      version: 1,
      phase: "complete",
      scope: own.value.scope,
      requests: 679,
      bytes: 142_370_116,
    },
    contract,
  );
  if (!preIncremental.ok) throw new Error(preIncremental.error.message);
  const silent = await runDay(site, D + 1, preIncremental.value);
  expect(silent.modelReads).toHaveLength(MODEL_COUNT);
  expect(silent.warnings.filter((w) => w.includes("Previous"))).toEqual([]);
});

test("incremental checkpoints re-derive carried evidence and request accounting", async () => {
  const site = yard();
  const cold = await runDay(site, D, null);
  // A run day whose slice reads two models, the first after a carried model, so
  // the paused prefix holds carried pages on both sides of one native read.
  const offset = [1, 2, 3, 4, 5].find((k) => {
    const sweep = sweepAt(site, D + k);
    return sweep.length >= 2 && (sweep[0] ?? 0) > 0;
  });
  if (offset === undefined) throw new Error("No sweep day reads two models");
  const [firstRead, secondRead] = sweepAt(site, D + offset);
  if (firstRead === undefined || secondRead === undefined)
    throw new Error("Expected two swept models");
  const paused = await Effect.runPromise(
    streamCaltonInventory({
      contract,
      previousUniqueInventory: null,
      previousCursor: cold.terminal,
      now: () => (D + offset) * MODEL_CENSUS_DAY_MS,
      maxPages: 6,
      readPage: (url) => {
        const raw = site.document(url);
        return raw === undefined
          ? Effect.fail(CaltonError.create("saved reader", "No " + url))
          : Effect.succeed(raw);
      },
      onBatch: () => Effect.void,
    }),
  );
  const cursor = paused.cursor;
  if (cursor.phase !== "models") throw new Error("Expected a models prefix");
  // Root, directory, three menus and the first swept model; every model before
  // the second swept model carries free.
  expect(cursor.requests).toBe(6);
  expect(cursor.pages).toHaveLength(secondRead);
  expect(CaltonCursor.checkpoint(cursor, contract).ok).toBe(true);
  const wire = CaltonCursor.serialize(cursor, contract);
  if (!wire.ok) throw new Error(wire.error.message);
  expect(CaltonCursor.fromWire(wire.value, contract).ok).toBe(true);
  const tampered = [
    // Dropping the census turns carried pages into unaccounted reads.
    { ...cursor, previous: null },
    { ...cursor, requests: cursor.requests - 1 },
    { ...cursor, day: null },
    { ...cursor, day: D - 1 },
    // A carried page must equal its census evidence exactly.
    {
      ...cursor,
      pages: cursor.pages.map((page, index) =>
        index === 0 ? { ...page, bodyHash: "f".repeat(64) } : page,
      ),
    },
    // The next model must be due for a read: the one after the first swept
    // model carries on this day.
    { ...cursor, pages: cursor.pages.slice(0, firstRead + 1) },
    {
      ...cursor,
      previous: cursor.previous && {
        ...cursor.previous,
        contract: "another parser",
      },
    },
  ];
  for (const state of tampered)
    expect(CaltonCursor.checkpoint(state, contract).ok).toBe(false);
});

test("a model page read short of its badge is read again on the next run", async () => {
  // Calton has no closing pass, so a short page read today is unconfirmed: the
  // next run reads it again instead of carrying it for up to six days. A
  // surplus first seen on a cold read is unconfirmed too, so the next normal
  // incremental run reads that page again and confirms it.
  const site = yard();
  const sweep = sweepAt(site, D + 1);
  const outside = [...Array(MODEL_COUNT).keys()].filter(
    (i) => !sweep.includes(i),
  );
  const [shortModel, extraModel] = outside;
  const dropped = site.models[shortModel ?? -1]?.stocks.at(-1);
  if (shortModel === undefined || extraModel === undefined || !dropped)
    throw new Error("fixture needs two models outside the next slice");
  site.short.add(shortModel);
  // Rows above the badge (observed on 22 live models) are not short.
  site.extra.add(extraModel);
  const cold = await runDay(site, D, null);
  expect(cold.published).not.toContain(vin(dropped));
  if (cold.cursor.phase !== "complete" || !cold.cursor.census)
    throw new Error("Expected a terminal census");
  expect(cold.cursor.census.models[shortModel]).toMatchObject({
    count: 2,
    confirmed: false,
  });
  expect(cold.cursor.census.models[shortModel]?.page.records).toHaveLength(1);
  expect(cold.cursor.census.models[extraModel]).toMatchObject({
    count: 2,
    readDay: D,
    expected: 3,
    lowSince: null,
    surplusConfirmed: false,
    confirmed: false,
  });
  // Day N + 1: the badge is unchanged and the page lists every donor again.
  // The unconfirmed surplus page, still listing its extra row, is read again
  // (short) beside the short page.
  site.short.clear();
  const next = await runDay(site, D + 1, cold.terminal);
  expect(shortModel).toBeLessThan(extraModel);
  expect(next.modelReads).toEqual(
    urlsAt(
      site,
      [...sweep, shortModel, extraModel].sort((a, b) => a - b),
    ),
  );
  expect(next.published).toContain(vin(dropped));
  expect(next.published).toContain(vin(`S${extraModel}X`));
  const reasons =
    (sweep[0] ?? Infinity) < shortModel
      ? `sweep ${sweep.length}, short 2`
      : `short 2, sweep ${sweep.length}`;
  expect(next.warnings).toContain(
    `Calton Read ${sweep.length + 2} of ${MODEL_COUNT} model pages (${reasons}); carried ${MODEL_COUNT - sweep.length - 2}.`,
  );
  if (next.cursor.phase !== "complete" || !next.cursor.census)
    throw new Error("Expected a terminal census");
  expect(next.cursor.census.models[shortModel]).toMatchObject({
    count: 2,
    readDay: D + 1,
    expected: 2,
    lowSince: null,
    surplusConfirmed: true,
    confirmed: false,
  });
  expect(next.cursor.census.models[shortModel]?.page.records).toHaveLength(2);
  expect(next.cursor.census.models[extraModel]).toMatchObject({
    count: 2,
    readDay: D + 1,
    expected: 3,
    lowSince: null,
    surplusConfirmed: true,
    confirmed: false,
  });
  // Day N + 2: both pages agree with their badge and confirmed surplus, so
  // they carry outside their slices.
  const settledSweep = sweepAt(site, D + 2);
  expect(settledSweep).not.toContain(shortModel);
  expect(settledSweep).not.toContain(extraModel);
  const settled = await runDay(site, D + 2, next.terminal);
  expect(settled.modelReads).toEqual(urlsAt(site, settledSweep));
  expect(settled.warnings).toContain(
    `Calton Read ${settledSweep.length} of ${MODEL_COUNT} model pages (sweep ${settledSweep.length}); carried ${MODEL_COUNT - settledSweep.length}.`,
  );
});

test("a run fails when today's swept model pages render empty while their badges hold", async () => {
  // A site fault empties model pages while the menus look normal. Carried
  // pages keep the floors satisfied, so only the badge coverage check sees
  // the one broken sweep slice.
  const site = yard();
  const cold = await runDay(site, D, null);
  const sweep = sweepAt(site, D + 1);
  expect(sweep.length).toBeGreaterThan(0);
  for (const index of sweep) site.broken.add(index);
  const published: string[] = [];
  const failure = await runDay(site, D + 1, cold.terminal, published).then(
    () => null,
    (error: unknown) => error,
  );
  expect(String(failure)).toContain("Calton model badge coverage");
  expect(String(failure)).toContain("below the 95% coverage floor");
  expect(published).toEqual([]);
});

test("a surplus page that drops to its badge is read again on the next run", async () => {
  // 22 live models list one row above their badge. A swept page that loses
  // that row lists exactly its badge, which neither the badge nor the badge
  // coverage can see. Its surplus is sticky, so it stays short of what it is
  // expected to list and every run reads it again, until reads at the badge
  // have lasted six run days and a normal incremental run lowers the surplus.
  const site = yard();
  // Four donors per model keep the one lost row above the replay floor.
  site.models.forEach((model, index) =>
    model.stocks.push(`S${index}C`, `S${index}D`),
  );
  const sweep = sweepAt(site, D + 1);
  const surplus = sweep[0];
  if (surplus === undefined) throw new Error("fixture needs a swept model");
  site.extra.add(surplus);
  const cold = await runDay(site, D, null);
  expect(cold.published).toContain(vin(`S${surplus}X`));
  if (cold.cursor.phase !== "complete" || !cold.cursor.census)
    throw new Error("Expected a terminal census");
  // A surplus first seen on a cold read is unconfirmed.
  expect(cold.cursor.census.models[surplus]).toMatchObject({
    count: 4,
    expected: 5,
    lowSince: null,
    surplusConfirmed: false,
  });
  // Day D + 1 sweeps the surplus page, which now lists exactly its badge.
  site.extra.clear();
  const dropped = await runDay(site, D + 1, cold.terminal);
  expect(dropped.modelReads).toEqual(urlsAt(site, sweep));
  expect(dropped.published).not.toContain(vin(`S${surplus}X`));
  if (dropped.cursor.phase !== "complete" || !dropped.cursor.census)
    throw new Error("Expected a terminal census");
  expect(dropped.cursor.census.models[surplus]).toMatchObject({
    count: 4,
    expected: 5,
    lowSince: D + 1,
    surplusConfirmed: false,
    confirmed: false,
  });
  expect(dropped.cursor.census.models[surplus]?.page.records).toHaveLength(4);
  // Days D + 2 to D + 6: the badge is unchanged and the page still lists only
  // its badge. One re-read does not accept it: each run reads it again (short)
  // and keeps the surplus and the day the low reads began. From D + 6 on, the
  // other models of each slice were last read six days earlier (stale).
  let previous = dropped.terminal;
  for (let day = D + 2; day <= D + 6; day++) {
    const daySweep = sweepAt(site, day);
    expect(daySweep).not.toContain(surplus);
    const run = await runDay(site, day, previous);
    expect(run.modelReads).toEqual(
      urlsAt(
        site,
        [...daySweep, surplus].sort((a, b) => a - b),
      ),
    );
    expect([...run.published].sort()).toEqual(expectedVins(site));
    expect(run.warnings).toContain(
      `Calton Read ${daySweep.length + 1} of ${MODEL_COUNT} model pages (${sweepAndOne(daySweep, surplus, "short", day - D >= MODEL_CENSUS_SWEEP_DAYS ? "stale" : "sweep")}); carried ${MODEL_COUNT - daySweep.length - 1}.`,
    );
    if (run.cursor.phase !== "complete" || !run.cursor.census)
      throw new Error("Expected a terminal census");
    expect(run.cursor.census.models[surplus]).toMatchObject({
      count: 4,
      readDay: day,
      expected: 5,
      lowSince: D + 1,
      surplusConfirmed: false,
      confirmed: false,
    });
    previous = run.terminal;
  }
  // Day D + 7 (lowSince + 6) is a normal incremental run: it reads the page
  // again (short, ahead of its stale slice) and lowers the surplus, keeping
  // it as a ceiling. Calton has no closing pass, so this read, below the
  // ceiling, is read again on the next run.
  const lowerSweep = sweepAt(site, D + 7);
  expect(lowerSweep).toEqual(sweep);
  const lowering = await runDay(site, D + 7, previous);
  expect(lowering.modelReads).toEqual(urlsAt(site, sweep));
  expect([...lowering.published].sort()).toEqual(expectedVins(site));
  const others = sweep.length - 1;
  expect(lowering.warnings).toContain(
    `Calton Read ${sweep.length} of ${MODEL_COUNT} model pages (short 1${others ? `, stale ${others}` : ""}); carried ${MODEL_COUNT - sweep.length}.`,
  );
  if (lowering.cursor.phase !== "complete" || !lowering.cursor.census)
    throw new Error("Expected a terminal census");
  expect(lowering.cursor.census.models[surplus]).toMatchObject({
    count: 4,
    readDay: D + 7,
    expected: 4,
    lowSince: null,
    ceiling: 1,
    ceilingSince: D + 7,
    recheck: true,
    surplusConfirmed: true,
    confirmed: false,
  });
  // Day D + 8 reads it again (short); the re-read lists the same cards, which
  // settles it.
  const recheckSweep = sweepAt(site, D + 8);
  expect(recheckSweep).not.toContain(surplus);
  const recheck = await runDay(site, D + 8, lowering.terminal);
  expect(recheck.modelReads).toEqual(
    urlsAt(
      site,
      [...recheckSweep, surplus].sort((a, b) => a - b),
    ),
  );
  expect([...recheck.published].sort()).toEqual(expectedVins(site));
  expect(recheck.warnings).toContain(
    `Calton Read ${recheckSweep.length + 1} of ${MODEL_COUNT} model pages (${sweepAndOne(recheckSweep, surplus, "short", "stale")}); carried ${MODEL_COUNT - recheckSweep.length - 1}.`,
  );
  if (recheck.cursor.phase !== "complete" || !recheck.cursor.census)
    throw new Error("Expected a terminal census");
  expect(recheck.cursor.census.models[surplus]).toMatchObject({
    count: 4,
    readDay: D + 8,
    expected: 4,
    ceiling: 1,
    ceilingSince: D + 7,
    recheck: false,
  });
  // From then on the page agrees with its badge and lowered surplus, so it
  // carries outside its slice.
  const settledSweep = sweepAt(site, D + 9);
  expect(settledSweep).not.toContain(surplus);
  const settled = await runDay(site, D + 9, recheck.terminal);
  expect(settled.modelReads).toEqual(urlsAt(site, settledSweep));
  expect([...settled.published].sort()).toEqual(expectedVins(site));
  expect(settled.warnings).toContain(
    `Calton Read ${settledSweep.length} of ${MODEL_COUNT} model pages (stale ${settledSweep.length}); carried ${MODEL_COUNT - settledSweep.length}.`,
  );
  if (settled.cursor.phase !== "complete" || !settled.cursor.census)
    throw new Error("Expected a terminal census");
  expect(settled.cursor.census.models[surplus]).toMatchObject({
    count: 4,
    readDay: D + 8,
    expected: 4,
    lowSince: null,
    recheck: false,
    surplusConfirmed: true,
  });
});

test("a run fails when today's swept pages list one card each while their badges hold", async () => {
  // Badges below their pages' rows (as on Calton's surplus models) keep badge
  // coverage at 100% when those pages are cut to one card each. Only the
  // replay of the last accepted card counts sees the broken sweep slice.
  const site = yard();
  const sweep = sweepAt(site, D + 1);
  expect(sweep.length).toBeGreaterThan(0);
  for (const index of sweep) {
    site.models[index]?.stocks.push(`S${index}C`);
    site.badges.set(index, 1);
  }
  const cold = await runDay(site, D, null);
  expect([...cold.published].sort()).toEqual(expectedVins(site));
  for (const index of sweep) site.cut.add(index);
  const published: string[] = [];
  const failure = await runDay(site, D + 1, cold.terminal, published).then(
    () => null,
    (error: unknown) => error,
  );
  expect(String(failure)).toContain("Calton model badge coverage");
  expect(String(failure)).toContain(
    "that the last accepted census listed, less any drop in their counts, below the 97% coverage floor",
  );
  expect(published).toEqual([]);
});

test("a faulted read below a time-lowered surplus is read again on the next run, not carried", async () => {
  // Badge 3, page 4 (a real placeholder). From D + 1 an arrival is counted
  // every day and its card appears a day later, so every read lists exactly
  // the badge and the twelve-day bound lowers the surplus on D + 13, keeping
  // it as a ceiling of 1. Calton has no closing pass, so a read below the
  // ceiling (including the one that lowers it) is read again on the next run.
  const site = yard();
  const [m] = sweepAt(site, D + 1);
  const model = m === undefined ? undefined : site.models[m];
  if (m === undefined || !model)
    throw new Error("fixture needs a model swept on D + 1");
  // Newest cards go first, so `short` (which omits the last donor) hides an
  // old real donor rather than the root arrival, which is published anyway.
  const dropped = `S${m}C`;
  model.stocks = [`S${m}P`, ...model.stocks, dropped];
  site.badges.set(m, 3);
  type Run = Awaited<ReturnType<typeof runDay>>;
  /** What a day read and published, its census evidence for model `m`, and
   * (apart, so a helper without them still shows the read trace) the ceiling
   * date and recheck marker. */
  const observe = (run: Run) => {
    if (run.cursor.phase !== "complete" || !run.cursor.census)
      throw new Error("Expected a terminal census");
    const e = run.cursor.census.models[m];
    if (!e) throw new Error("Missing census evidence for model " + m);
    return {
      trace: {
        reads: run.modelReads,
        summary: run.warnings.find((w) => w.startsWith("Calton Read ")),
        missing: expectedVins(site).filter((v) => !run.published.includes(v)),
        evidence: {
          readDay: e.readDay,
          count: e.count,
          expected: e.expected,
          ceiling: e.ceiling,
          cards: e.page.records.length,
        },
      },
      marker: { ceilingSince: e.ceilingSince, recheck: e.recheck },
    };
  };
  /** Model reads and summary of a day reading its slice and, unless
   * `reason` is null, model `m` for that reason. */
  const reading = (day: number, reason: string | null) => {
    const slice = day - D >= MODEL_CENSUS_SWEEP_DAYS ? "stale" : "sweep";
    const reads = [
      ...sweepAt(site, day)
        .filter((index) => index !== m)
        .map((index) => ({ index, reason: slice })),
      ...(reason === null ? [] : [{ index: m, reason }]),
    ].sort((a, b) => a.index - b.index);
    const counts = new Map<string, number>();
    for (const read of reads)
      counts.set(read.reason, (counts.get(read.reason) ?? 0) + 1);
    const reasons = [...counts].map(([r, n]) => `${r} ${n}`).join(", ");
    return {
      reads: urlsAt(
        site,
        reads.map((read) => read.index),
      ),
      summary: `Calton Read ${reads.length} of ${MODEL_COUNT} model pages${reasons ? ` (${reasons})` : ""}; carried ${MODEL_COUNT - reads.length}.`,
    };
  };
  /** The card of yesterday's arrival appears, first on the page and at root. */
  const appear = (stock: string) => {
    model.stocks.unshift(stock);
    site.arrival.model = m;
    site.arrival.stock = stock;
  };

  // D + 1 to D + 12: the badge rises every day and the page lists exactly the
  // badge. L = D + 13: the last arrival is counted and the bound lowers the
  // surplus. L + 1: the badge stops rising and the lag holds one more day.
  // L + 2: the lag drains (the page should list badge + 1) and the root
  // arrival triggers a read in which a one-off fault hides a real donor.
  // L + 3: the fault is gone.
  const L = D + 13;
  const timeline: ReturnType<typeof observe>[] = [];
  let previous: unknown = null;
  for (let day = D; day <= L + 5; day++) {
    const k = day - D;
    if (k >= 1 && k <= 13) site.badges.set(m, 3 + k);
    if (k >= 2 && k <= 13) appear(`S${m}N${k - 1}`);
    if (day === L + 2) {
      appear(`S${m}N13`);
      site.short.add(m);
    }
    if (day === L + 3) site.short.delete(m);
    const run = await runDay(site, day, previous);
    timeline.push(observe(run));
    previous = run.terminal;
  }
  const evidence = (readDay: number, count: number, expected: number) => ({
    readDay,
    count,
    expected,
    ceiling: null,
    cards: count,
  });
  const lowered = (readDay: number) => ({
    readDay,
    count: 16,
    expected: 16,
    ceiling: 1,
    cards: 16,
  });
  const healed = { ...evidence(L + 3, 16, 17), cards: 17 };
  expect(timeline.map((day) => day.trace)).toEqual([
    {
      reads: urlsAt(site, [...Array(MODEL_COUNT).keys()]),
      summary: `Calton Read ${MODEL_COUNT} of ${MODEL_COUNT} model pages (cold ${MODEL_COUNT}); carried 0.`,
      missing: [],
      evidence: { ...evidence(D, 3, 4), cards: 4 },
    },
    // The badge rises daily (a count read), so the surplus holds as lag.
    ...Array.from({ length: 12 }, (_, i) => ({
      ...reading(D + 1 + i, "count"),
      missing: [],
      evidence: evidence(D + 1 + i, 4 + i, 5 + i),
    })),
    // The twelve-day bound lowers the surplus, keeping it as a ceiling.
    { ...reading(L, "count"), missing: [], evidence: lowered(L) },
    // The read below the ceiling is read again and lists the same cards.
    { ...reading(L + 1, "short"), missing: [], evidence: lowered(L + 1) },
    // The faulted read lists exactly the badge, below the ceiling.
    {
      ...reading(L + 2, "trigger"),
      missing: [vin(dropped)],
      evidence: lowered(L + 2),
    },
    // The next run reads it again instead of carrying it, and the healthy
    // re-read restores the surplus and clears the ceiling: the faulted page
    // was published for that one run only.
    { ...reading(L + 3, "short"), missing: [], evidence: healed },
    { ...reading(L + 4, null), missing: [], evidence: healed },
    { ...reading(L + 5, null), missing: [], evidence: healed },
  ]);
  const unmarked = { ceilingSince: null, recheck: false };
  expect(timeline.map((day) => day.marker)).toEqual([
    ...Array.from({ length: 13 }, () => unmarked),
    // The read that lowers the surplus is below the ceiling: read again.
    { ceilingSince: L, recheck: true },
    // Two reads agree, which settles it.
    { ceilingSince: L, recheck: false },
    // The faulted read is below the ceiling again: read again.
    { ceilingSince: L, recheck: true },
    unmarked,
    unmarked,
    unmarked,
  ]);
});

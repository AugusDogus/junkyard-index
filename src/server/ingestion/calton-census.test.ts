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
import { caltonFixtureDocument } from "./calton-test-fixtures";
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
            control(`/parts/${m.make}/${m.label}`, m.label, m.stocks.length),
          )
          .join("")}</div>`,
        "/parts/" + make,
      );
    const model = models.find((m) => modelUrl(m) === url);
    return model
      ? caltonFixtureDocument(
          `<div id="iiscont"><div class="aps-la-grid">${model.stocks
            .map((stock) => card(model, stock))
            .join("")}</div></div>`,
          `/parts/${model.make}/${model.label}`,
        )
      : undefined;
  };
  return { models, arrival, document };
}
type Yard = ReturnType<typeof yard>;

/** One daily pass in eight-request chunks, resuming from each paused cursor. */
async function runDay(site: Yard, day: number, previousCursor: unknown) {
  const requests: string[] = [];
  const published: string[] = [];
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
const sweepAndOne = (sweep: readonly number[], index: number, reason: string) =>
  (sweep[0] ?? Infinity) < index
    ? `sweep ${sweep.length}, ${reason} 1`
    : `${reason} 1, sweep ${sweep.length}`;
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

test("missed run days read every model whose evidence reached the age ceiling", async () => {
  const site = yard();
  const cold = await runDay(site, D, null);
  const late = await runDay(site, D + 3, cold.terminal);
  const lateSweep = sweepAt(site, D + 3);
  expect(lateSweep.length).toBeGreaterThan(0);
  expect(late.modelReads).toEqual(urlsAt(site, lateSweep));
  // Day D + 8: every model last read on day D is stale; the ones read on D + 3
  // are read again only when they fall in this day's slice.
  const laterSweep = sweepAt(site, D + 8);
  const later = await runDay(site, D + 8, late.terminal);
  expect(later.modelReads).toEqual(
    urlsAt(
      site,
      [...Array(MODEL_COUNT).keys()].filter(
        (i) => !lateSweep.includes(i) || laterSweep.includes(i),
      ),
    ),
  );
  expect([...later.published].sort()).toEqual(expectedVins(site));
  if (later.cursor.phase !== "complete" || !later.cursor.census)
    throw new Error("Expected a terminal census");
  for (const model of later.cursor.census.models)
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

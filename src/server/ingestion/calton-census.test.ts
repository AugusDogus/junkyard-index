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
import { MODEL_CENSUS_DAY_MS } from "./model-census";

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
// Day 20,412 is a multiple of six, so day D + k sweeps model ordinals k % 6.
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
  expect(run.cursor.census.models).toHaveLength(MODEL_COUNT);
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
  expect(next.modelReads).toEqual(urlsAt(site, [1, 7]));
  expect(next.requests).toHaveLength(2 + MAKES.length + 2);
  expect([...next.published].sort()).toEqual(expectedVins(site));
  expect(next.warnings).toContain(
    `Calton Read 2 of ${MODEL_COUNT} model pages (sweep 2); carried ${MODEL_COUNT - 2}.`,
  );
});

test("the sweep reads a sixth of the models each day and every model within six days", async () => {
  const site = yard();
  let previous = (await runDay(site, D, null)).terminal;
  const read = new Set<string>();
  for (let offset = 1; offset <= 6; offset++) {
    const run = await runDay(site, D + offset, previous);
    expect(run.modelReads).toEqual(
      urlsAt(site, [offset % 6, (offset % 6) + 6]),
    );
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
  expect(late.modelReads).toEqual(urlsAt(site, [3, 9]));
  const later = await runDay(site, D + 8, late.terminal);
  expect(later.modelReads).toEqual(
    urlsAt(
      site,
      [...Array(MODEL_COUNT).keys()].filter((i) => i !== 3 && i !== 9),
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
  site.models[4]?.stocks.push("S4C");
  const next = await runDay(site, D + 1, cold.terminal);
  expect(next.modelReads).toEqual(urlsAt(site, [1, 4, 7]));
  expect(next.published).toContain(vin("S4C"));
  expect(next.warnings).toContain(
    `Calton Read 3 of ${MODEL_COUNT} model pages (sweep 2, count 1); carried ${MODEL_COUNT - 3}.`,
  );
});

test("a root arrival missing from its model's carried page triggers that read", async () => {
  const site = yard();
  const cold = await runDay(site, D, null);
  // Same-count swap: the badge alone cannot see it, the arrival can.
  const model = site.models[5];
  if (!model) throw new Error("Missing test model");
  model.stocks = ["S5A", "S5N"];
  site.arrival.model = 5;
  site.arrival.stock = "S5N";
  const next = await runDay(site, D + 1, cold.terminal);
  expect(next.modelReads).toEqual(urlsAt(site, [1, 5, 7]));
  expect([...next.published].sort()).toEqual(expectedVins(site));
  expect(next.published).not.toContain(vin("S5B"));
  expect(next.warnings).toContain(
    `Calton Read 3 of ${MODEL_COUNT} model pages (sweep 2, trigger 1); carried ${MODEL_COUNT - 3}.`,
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
  const paused = await Effect.runPromise(
    streamCaltonInventory({
      contract,
      previousUniqueInventory: null,
      previousCursor: cold.terminal,
      now: () => (D + 1) * MODEL_CENSUS_DAY_MS,
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
  // Root, directory, three menus and model 1; models 0 and 2 to 6 carry free.
  expect(cursor.requests).toBe(6);
  expect(cursor.pages).toHaveLength(7);
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
    // The next model must be due for a read: model 2 carries on day D + 1.
    { ...cursor, pages: cursor.pages.slice(0, 2) },
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

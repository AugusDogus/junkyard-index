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
const ALL = [...Array(MODEL_COUNT).keys()];
/** Summary of an incremental run, which reads every model page: `daily`
 * unless `reasons` names another read reason for a model. Reasons appear in
 * the published order of their first model. */
const dailySummary = (reasons: ReadonlyMap<number, string> = new Map()) => {
  const counts = new Map<string, number>();
  for (const index of ALL) {
    const reason = reasons.get(index) ?? "daily";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const list = [...counts].map(([reason, n]) => `${reason} ${n}`).join(", ");
  return `Calton Read ${MODEL_COUNT} of ${MODEL_COUNT} model pages (${list}); carried 0.`;
};
/** Root, make directory, every make menu and every model page. */
const FULL_READ = 2 + MAKES.length + MODEL_COUNT;
/** Every model in the terminal census was read on `day`. */
function expectReadOn(run: { cursor: Cursor }, day: number) {
  if (run.cursor.phase !== "complete" || !run.cursor.census)
    throw new Error("Expected a terminal census");
  expect(run.cursor.census.models.map((m) => m.readDay)).toEqual(
    ALL.map(() => day),
  );
}
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

test("an incremental run after an accepted census reads every model page and publishes every donor", async () => {
  const site = yard();
  const cold = await runDay(site, D, null);
  const next = await runDay(site, D + 1, cold.terminal);
  // Opening reads root, the make directory and every make menu; no closing pass.
  expect(next.requests.slice(0, 2 + MAKES.length)).toEqual([
    CALTON_ROOT,
    CALTON_MAKES,
    ...MAKES.map((make) => `${CALTON_ORIGIN}/parts/${make}`),
  ]);
  // An unchanged key and badge carry nothing: the run costs a full read.
  expect(next.modelReads).toEqual(urlsAt(site, ALL));
  expect(next.requests).toHaveLength(FULL_READ);
  expect(next.requests).toHaveLength(cold.requests.length);
  expect([...next.published].sort()).toEqual(expectedVins(site));
  expect(next.warnings).toContain(dailySummary());
  expectReadOn(next, D + 1);
});

test("consecutive daily runs read every model page every day", async () => {
  const site = yard();
  let previous = (await runDay(site, D, null)).terminal;
  for (let day = D + 1; day <= D + 7; day++) {
    const run = await runDay(site, day, previous);
    expect(run.modelReads).toEqual(urlsAt(site, ALL));
    expect(run.requests).toHaveLength(FULL_READ);
    expect([...run.published].sort()).toEqual(expectedVins(site));
    expect(run.warnings).toContain(dailySummary());
    expectReadOn(run, day);
    previous = run.terminal;
  }
});

test("a missed run day reads every model as a gap, then daily runs resume", async () => {
  const site = yard();
  const cold = await runDay(site, D, null);
  const daily = await runDay(site, D + 1, cold.terminal);
  expect(daily.warnings).toContain(dailySummary());
  // Day D + 2 is missed, so day D + 3 reads every model page as a gap.
  const late = await runDay(site, D + 3, daily.terminal);
  expect(late.modelReads).toEqual(urlsAt(site, ALL));
  expect([...late.published].sort()).toEqual(expectedVins(site));
  expect(late.warnings).toContain(
    `Calton Read ${MODEL_COUNT} of ${MODEL_COUNT} model pages (gap ${MODEL_COUNT}); carried 0.`,
  );
  // Daily runs from D + 4 read every model page again (daily).
  let previous = late.terminal;
  for (let day = D + 4; day <= D + 8; day++) {
    const run = await runDay(site, day, previous);
    expect(run.modelReads).toEqual(urlsAt(site, ALL));
    expect(run.requests).toHaveLength(FULL_READ);
    expect([...run.published].sort()).toEqual(expectedVins(site));
    expect(run.warnings).toContain(dailySummary());
    expectReadOn(run, day);
    previous = run.terminal;
  }
});

test("a changed model badge reads that model for its count and publishes its new donor", async () => {
  const site = yard();
  const cold = await runDay(site, D, null);
  const changed = 5;
  const model = site.models[changed];
  if (!model) throw new Error("Missing test model");
  model.stocks.push(`S${changed}C`);
  const next = await runDay(site, D + 1, cold.terminal);
  expect(next.modelReads).toEqual(urlsAt(site, ALL));
  expect(next.requests).toHaveLength(FULL_READ);
  expect(next.published).toContain(vin(`S${changed}C`));
  expect([...next.published].sort()).toEqual(expectedVins(site));
  expect(next.warnings).toContain(dailySummary(new Map([[changed, "count"]])));
});

test("a donor crushed and another placed under the same badge is read and replaced", async () => {
  // One donor out and another in keeps the model badge, and no root arrival
  // names the new donor, so neither the badge nor a trigger sees the swap.
  // Badge-only reuse would carry the old page; the daily read replaces it.
  const site = yard();
  const cold = await runDay(site, D, null);
  const swapped = 5;
  expect(site.arrival.model).not.toBe(swapped);
  const model = site.models[swapped];
  if (!model) throw new Error("Missing test model");
  expect(cold.published).toContain(vin(`S${swapped}B`));
  model.stocks = [`S${swapped}A`, `S${swapped}N`];
  const next = await runDay(site, D + 1, cold.terminal);
  expect(next.modelReads).toEqual(urlsAt(site, ALL));
  expect(next.requests).toHaveLength(FULL_READ);
  expect(next.published).toContain(vin(`S${swapped}N`));
  expect(next.published).not.toContain(vin(`S${swapped}B`));
  expect([...next.published].sort()).toEqual(expectedVins(site));
  expect(next.warnings).toContain(dailySummary());
  if (next.cursor.phase !== "complete" || !next.cursor.census)
    throw new Error("Expected a terminal census");
  // The accepted evidence for that model is today's page, not the old one.
  const evidence = next.cursor.census.models[swapped];
  expect(evidence).toMatchObject({ count: 2, readDay: D + 1 });
  const cards = JSON.stringify(evidence?.page.records);
  expect(cards).toContain(vin(`S${swapped}N`));
  expect(cards).not.toContain(vin(`S${swapped}B`));
});

test("a root arrival missing from its model's last accepted page reads that model as a trigger", async () => {
  const site = yard();
  const cold = await runDay(site, D, null);
  // Same-count swap that a root arrival names: the read reason is trigger.
  const swapped = 5;
  expect(site.arrival.model).not.toBe(swapped);
  const model = site.models[swapped];
  if (!model) throw new Error("Missing test model");
  model.stocks = [`S${swapped}A`, `S${swapped}N`];
  site.arrival.model = swapped;
  site.arrival.stock = `S${swapped}N`;
  const next = await runDay(site, D + 1, cold.terminal);
  expect(next.modelReads).toEqual(urlsAt(site, ALL));
  expect(next.requests).toHaveLength(FULL_READ);
  expect([...next.published].sort()).toEqual(expectedVins(site));
  expect(next.published).not.toContain(vin(`S${swapped}B`));
  expect(next.warnings).toContain(
    dailySummary(new Map([[swapped, "trigger"]])),
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

test("incremental checkpoints account every model page as a native read", async () => {
  const site = yard();
  const cold = await runDay(site, D, null);
  const paused = await Effect.runPromise(
    streamCaltonInventory({
      contract,
      previousUniqueInventory: null,
      previousCursor: cold.terminal,
      now: () => (D + 1) * MODEL_CENSUS_DAY_MS,
      maxPages: 8,
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
  // Root, directory, three menus and the first three model pages: with an
  // accepted census in place, no model page is carried free.
  expect(cursor.previous?.day).toBe(D);
  expect(cursor.requests).toBe(8);
  expect(cursor.pages).toHaveLength(3);
  expect(cursor.pages.map((page) => page.sourceUrl)).toEqual(
    urlsAt(site, [0, 1, 2]),
  );
  expect(CaltonCursor.checkpoint(cursor, contract).ok).toBe(true);
  const wire = CaltonCursor.serialize(cursor, contract);
  if (!wire.ok) throw new Error(wire.error.message);
  expect(CaltonCursor.fromWire(wire.value, contract).ok).toBe(true);
  const tampered = [
    // Model pages accounted as if they were carried free.
    { ...cursor, requests: 2 + MAKES.length },
    { ...cursor, requests: cursor.requests - 1 },
    // A page prefix shorter than the reads it accounts for.
    { ...cursor, pages: cursor.pages.slice(0, 2) },
    { ...cursor, day: null },
    { ...cursor, day: D - 1 },
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
  // next run reads it for that reason (short) beside the daily reads. A
  // surplus first seen on a cold read is unconfirmed too, so the next normal
  // incremental run reads that page for the same reason and confirms it.
  const site = yard();
  const shortModel = 2;
  const extraModel = 7;
  const dropped = site.models[shortModel]?.stocks.at(-1);
  if (!dropped) throw new Error("fixture needs a short model donor");
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
  // (short) beside the short page; every other page is read daily.
  site.short.clear();
  const next = await runDay(site, D + 1, cold.terminal);
  expect(next.modelReads).toEqual(urlsAt(site, ALL));
  expect(next.requests).toHaveLength(FULL_READ);
  expect(next.published).toContain(vin(dropped));
  expect(next.published).toContain(vin(`S${extraModel}X`));
  expect(next.warnings).toContain(
    dailySummary(
      new Map([
        [shortModel, "short"],
        [extraModel, "short"],
      ]),
    ),
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
  // they are read daily like every other page.
  const settled = await runDay(site, D + 2, next.terminal);
  expect(settled.modelReads).toEqual(urlsAt(site, ALL));
  expect(settled.published).toContain(vin(dropped));
  expect(settled.warnings).toContain(dailySummary());
});

test("a run fails when a sixth of the model pages render empty while their badges hold", async () => {
  // A site fault empties model pages while the menus look normal. Every page
  // is read daily, so the badge coverage check sees the broken pages on the
  // first broken day.
  const site = yard();
  const cold = await runDay(site, D, null);
  for (const index of [0, 7]) site.broken.add(index);
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
  // 22 live models list one row above their badge. A page that loses that
  // row lists exactly its badge, which neither the badge nor the badge
  // coverage can see. Its surplus is sticky, so it stays short of what it is
  // expected to list and every run reads it for that reason (short), until
  // reads at the badge have lasted six run days and a normal incremental run
  // lowers the surplus.
  const site = yard();
  // Four donors per model keep the one lost row above the replay floor.
  site.models.forEach((model, index) =>
    model.stocks.push(`S${index}C`, `S${index}D`),
  );
  const surplus = 3;
  const shortOnly = new Map([[surplus, "short"]]);
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
  // Day D + 1 reads the surplus page, which now lists exactly its badge.
  site.extra.clear();
  const dropped = await runDay(site, D + 1, cold.terminal);
  expect(dropped.modelReads).toEqual(urlsAt(site, ALL));
  expect(dropped.warnings).toContain(dailySummary(shortOnly));
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
  // and keeps the surplus and the day the low reads began.
  let previous = dropped.terminal;
  for (let day = D + 2; day <= D + 6; day++) {
    const run = await runDay(site, day, previous);
    expect(run.modelReads).toEqual(urlsAt(site, ALL));
    expect([...run.published].sort()).toEqual(expectedVins(site));
    expect(run.warnings).toContain(dailySummary(shortOnly));
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
  // again (short) and lowers the surplus, keeping it as a ceiling. Calton has
  // no closing pass, so this read, below the ceiling, is read again on the
  // next run.
  const lowering = await runDay(site, D + 7, previous);
  expect(lowering.modelReads).toEqual(urlsAt(site, ALL));
  expect([...lowering.published].sort()).toEqual(expectedVins(site));
  expect(lowering.warnings).toContain(dailySummary(shortOnly));
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
  const recheck = await runDay(site, D + 8, lowering.terminal);
  expect(recheck.modelReads).toEqual(urlsAt(site, ALL));
  expect([...recheck.published].sort()).toEqual(expectedVins(site));
  expect(recheck.warnings).toContain(dailySummary(shortOnly));
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
  // is read daily like every other page. Every read still lists less than
  // the live ceiling, so the shared rule marks it for a recheck again; that
  // only names the next run's read reason, since every page is read anyway.
  const settled = await runDay(site, D + 9, recheck.terminal);
  expect(settled.modelReads).toEqual(urlsAt(site, ALL));
  expect([...settled.published].sort()).toEqual(expectedVins(site));
  expect(settled.warnings).toContain(dailySummary());
  if (settled.cursor.phase !== "complete" || !settled.cursor.census)
    throw new Error("Expected a terminal census");
  expect(settled.cursor.census.models[surplus]).toMatchObject({
    count: 4,
    readDay: D + 9,
    expected: 4,
    lowSince: null,
    ceiling: 1,
    ceilingSince: D + 7,
    recheck: true,
    surplusConfirmed: true,
  });
});

test("a run fails when a sixth of the model pages list one card each while their badges hold", async () => {
  // Badges below their pages' rows (as on Calton's surplus models) keep badge
  // coverage at 100% when those pages are cut to one card each. Only the
  // replay of the last accepted card counts sees the broken pages.
  const site = yard();
  const cutModels = [0, 7];
  for (const index of cutModels) {
    site.models[index]?.stocks.push(`S${index}C`);
    site.badges.set(index, 1);
  }
  const cold = await runDay(site, D, null);
  expect([...cold.published].sort()).toEqual(expectedVins(site));
  for (const index of cutModels) site.cut.add(index);
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

test("a faulted read below a time-lowered surplus is read again on the next run", async () => {
  // Badge 3, page 4 (a real placeholder). From D + 1 an arrival is counted
  // every day and its card appears a day later, so every read lists exactly
  // the badge and the twelve-day bound lowers the surplus on D + 13, keeping
  // it as a ceiling of 1. Calton has no closing pass, so a read below the
  // ceiling (including the one that lowers it) is read again on the next run
  // for that reason (short) rather than only as a daily read.
  const site = yard();
  const m = 1;
  const model = site.models[m];
  if (!model) throw new Error("fixture needs model " + m);
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
  /** Model reads and summary of an incremental day: every model page, read
   * daily except model `m`, read for `reason` unless it is null. */
  const reading = (reason: string | null) => ({
    reads: urlsAt(site, ALL),
    summary: dailySummary(reason === null ? new Map() : new Map([[m, reason]])),
  });
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
  const healed = (readDay: number) => ({
    ...evidence(readDay, 16, 17),
    cards: 17,
  });
  expect(timeline.map((day) => day.trace)).toEqual([
    {
      reads: urlsAt(site, ALL),
      summary: `Calton Read ${MODEL_COUNT} of ${MODEL_COUNT} model pages (cold ${MODEL_COUNT}); carried 0.`,
      missing: [],
      evidence: { ...evidence(D, 3, 4), cards: 4 },
    },
    // The badge rises daily (a count read), so the surplus holds as lag.
    ...Array.from({ length: 12 }, (_, i) => ({
      ...reading("count"),
      missing: [],
      evidence: evidence(D + 1 + i, 4 + i, 5 + i),
    })),
    // The twelve-day bound lowers the surplus, keeping it as a ceiling.
    { ...reading("count"), missing: [], evidence: lowered(L) },
    // The read below the ceiling is read again and lists the same cards.
    { ...reading("short"), missing: [], evidence: lowered(L + 1) },
    // The faulted read lists exactly the badge, below the ceiling.
    {
      ...reading("trigger"),
      missing: [vin(dropped)],
      evidence: lowered(L + 2),
    },
    // The next run reads it again (short), and the healthy re-read restores
    // the surplus and clears the ceiling: the faulted page was published for
    // that one run only.
    { ...reading("short"), missing: [], evidence: healed(L + 3) },
    { ...reading(null), missing: [], evidence: healed(L + 4) },
    { ...reading(null), missing: [], evidence: healed(L + 5) },
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

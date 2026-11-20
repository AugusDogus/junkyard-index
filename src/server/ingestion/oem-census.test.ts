import { expect, test } from "bun:test";
import { Effect } from "effect";
import { serializeDurableSourceCursor } from "./durable-cursor";
import {
  MODEL_CENSUS_DAY_MS,
  MODEL_CENSUS_SWEEP_DAYS,
  ModelCensus,
} from "./model-census";
import { streamOemInventory } from "./oem-connector";
import { OemCursor } from "./oem-cursor";
import { OEM_ARRIVALS, OEM_MAKES, OEM_ORIGIN } from "./oem-html";
import { oemControlUrl } from "./oem-parser";
import { oemFixtureDocument } from "./oem-test-fixtures";

const location = {
  code: "oem-bluffton",
  name: "OEM Auto Recyclers",
  city: "Bluffton",
  lat: 40.848554,
  lng: -83.8706706,
};
const makeUrl = OEM_ORIGIN + "/parts/FORD";
const modelPath = (model: number) => `/parts/FORD/M${model}/`;
interface Donor {
  model: number;
  stock: string;
  vin: string;
}
const donor = (model: number, n: number): Donor => ({
  model,
  stock: String(10000 + model * 1000 + n),
  vin: "1FTMF1KP0RK" + String(model * 1000 + n).padStart(6, "0"),
});
const donors = (model: number, n = 40) =>
  Array.from({ length: n }, (_, i) => donor(model, i + 1));
const card = ({ model, stock, vin }: Donor) =>
  `<div id="${stock}" class="card card-price"><div class="card-body"><div class="car-details">
  <b>Stock:</b> ${stock}<br><b>Year:</b> 2024<br><b>Make/Model :</b> FORD M${model}<br>
  <b>Vin :</b> ${vin}<br></div>
  <a class="buy-now" href="//oemautorecyclers.com/parts/FORD/M${model}/${stock}/2024">See Parts <span></span></a>
  </div></div>`;
const badge = (href: string, label: string, count: number) =>
  `<li><a href="${href}">${label} <span class="badge badge-light">${count}</span></a></li>`;

const nativeEmpty =
  '<div class="alert alert-warning m-3 text-center" role="alert"><h3>No Results Found. Try Browsing Our Parts Or Search Again</h3></div>';

/** One make with twelve models of 40 donors each; `rows`, `badges` and the
 * arrivals can change between runs. A model badge defaults to its card count;
 * `badges` overrides it, since native badges also count donors that are not
 * on the model page yet. A model without rows renders the native explicit
 * empty result. */
function yard() {
  const rows = new Map(Array.from({ length: 12 }, (_, i) => [i, donors(i)]));
  const badges = new Map<number, number>();
  // Models whose page renders the native empty result while the menu still
  // counts their donors.
  const broken = new Set<number>();
  // Models whose page renders only its first card while the menu still counts
  // every donor.
  const cut = new Set<number>();
  const count = (i: number, list: Donor[]) => badges.get(i) ?? list.length;
  // Arrivals always list at least one card; this donor is already on M0.
  let arrivals: Donor[] = [donor(0, 1)];
  const urls: string[] = [];
  const page = (url: string) => {
    const total = [...rows].reduce((n, [i, list]) => n + count(i, list), 0);
    const model = /\/parts\/FORD\/M(\d+)\/$/.exec(url);
    if (url === OEM_ARRIVALS)
      return oemFixtureDocument(
        `<div>Displaying <span id="filteredvehicleCount">${arrivals.length}</span> of <span id="vehicleCount">${arrivals.length}</div>${arrivals.map(card).join("")}`,
        OEM_ARRIVALS,
      );
    if (url === OEM_MAKES)
      return oemFixtureDocument(
        `<div class="iisMakesMenu"><ul class="menu">${badge(makeUrl, "FORD", total)}</ul></div>`,
      );
    if (url === makeUrl)
      return oemFixtureDocument(
        `<div id="menumodellist"><ul class="menu">${[...rows]
          .map(([i, list]) =>
            badge(
              "//oemautorecyclers.com" + modelPath(i),
              "M" + i,
              count(i, list),
            ),
          )
          .join("")}</ul></div>`,
      );
    if (model) {
      const index = Number(model[1]);
      const all = broken.has(index) ? [] : (rows.get(index) ?? []);
      const list = cut.has(index) ? all.slice(0, 1) : all;
      return oemFixtureDocument(
        list.length ? list.map(card).join("") : nativeEmpty,
      );
    }
    throw new Error("Unexpected request " + url);
  };
  return {
    rows,
    badges,
    broken,
    cut,
    urls,
    readPage: (url: string) =>
      Effect.sync(() => {
        urls.push(url);
        return page(url);
      }),
    setArrivals: (next: Donor[]) => {
      arrivals = next;
    },
  };
}

/** A terminal cursor as loadPublishedSourceCursor returns it: the durable
 * wire format (which omits `source`), JSON-parsed. */
const stored = (cursor: OemCursor): unknown =>
  JSON.parse(serializeDurableSourceCursor(cursor));

/** One full run on `day`, seeded by the previous terminal cursor. */
async function census(
  native: ReturnType<typeof yard>,
  day: number,
  previousCursor: unknown,
) {
  const before = native.urls.length;
  let cursor: unknown = OemCursor.initial();
  let terminal: OemCursor | null = null;
  const vins: string[] = [];
  const warnings: string[] = [];
  while (terminal === null) {
    const result = await Effect.runPromise(
      streamOemInventory({
        startCursor: cursor,
        // Only the first chunk may adopt a census; later chunks must not.
        previousCursor,
        now: () => day * MODEL_CENSUS_DAY_MS + 7 * 60 * 60 * 1000,
        maxPages: 3,
        location,
        minimumUniqueInventory: 400,
        previousUniqueInventory: null,
        readPage: native.readPage,
        onBatch: (batch) =>
          Effect.sync(() => {
            vins.push(...batch.map((v) => v.vin));
          }),
      }),
    );
    warnings.push(...result.warnings);
    if (result.status === "complete") terminal = result.cursor;
    cursor = JSON.parse(JSON.stringify(result.cursor));
  }
  const models = native.urls
    .slice(before)
    .flatMap((url) => /\/parts\/FORD\/M(\d+)\/$/.exec(url)?.[1] ?? [])
    .map(Number);
  return {
    terminal,
    wire: stored(terminal),
    requests: native.urls.length - before,
    models,
    vins: vins.sort(),
    warnings,
  };
}

const MODELS = Array.from({ length: 12 }, (_, i) => i);
/** The census key oemCensusControls builds for fixture model `model`: resolved
 * make route and label, then resolved model route and label. */
const modelKey = (model: number) =>
  JSON.stringify([
    oemControlUrl({ url: makeUrl, label: "FORD" }, 2),
    "FORD",
    oemControlUrl(
      { url: "//oemautorecyclers.com" + modelPath(model), label: "M" + model },
      3,
    ),
    "M" + model,
  ]);
/** Fixture models in the sweep slice of `day`, in menu order. */
const sweep = (day: number) =>
  MODELS.filter(
    (m) => ModelCensus.slice(modelKey(m)) === day % MODEL_CENSUS_SWEEP_DAYS,
  );
/** First day from `from` on, while the day-600 cold evidence is still under the
 * age ceiling, that satisfies `ok`. */
function dayAfterCold(ok: (day: number) => boolean, from = 601) {
  for (let day = from; day < 600 + MODEL_CENSUS_SWEEP_DAYS; day++)
    if (ok(day)) return day;
  throw new Error("No day before the age ceiling fits this fixture");
}
/** First fixture model other than M0 (which holds the default arrival) for
 * which `ok` holds. */
function pickModel(ok: (model: number) => boolean) {
  const model = MODELS.find((m) => m !== 0 && ok(m));
  if (model === undefined) throw new Error("No fixture model fits this test");
  return model;
}
const sorted = (models: number[]) => [...models].sort((a, b) => a - b);
/** The run summary for disjoint read reasons, listed in menu order of each
 * reason's first model as ModelCensus.summary does. */
function summary(reasons: [string, number[]][]) {
  const used = reasons
    .filter(([, models]) => models.length)
    .sort(([, a], [, b]) => Math.min(...a) - Math.min(...b));
  const read = used.reduce((n, [, models]) => n + models.length, 0);
  const detail = used.map(([reason, models]) => `${reason} ${models.length}`);
  return `OEM Read ${read} of 12 model pages${detail.length ? ` (${detail.join(", ")})` : ""}; carried ${12 - read}.`;
}

const allVins = (native: ReturnType<typeof yard>, extra: Donor[] = []) =>
  [
    ...new Set(
      [...[...native.rows.values()].flat(), ...extra].map((d) => d.vin),
    ),
  ].sort();

test("OEM cold start reads every model and publishes its census", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  expect(cold.models).toEqual(Array.from({ length: 12 }, (_, i) => i));
  // Arrivals, makes, one menu, 12 models and the closing make directory.
  expect(cold.requests).toBe(16);
  expect(cold.terminal.requests).toBe(16);
  expect(cold.vins).toEqual(allVins(native));
  expect(cold.warnings).toEqual([
    "OEM Read 12 of 12 model pages (cold 12); carried 0.",
  ]);
  if (cold.terminal.state.phase !== "complete")
    throw new Error("Expected a terminal census");
  expect(cold.terminal.state.census?.models.map((m) => m.key)).toEqual(
    MODELS.map(modelKey),
  );
});

test("OEM unreadable or incompatible previous checkpoints start a warned cold census", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const junk = await census(native, 601, { source: "oem", junk: true });
  expect(junk.models).toHaveLength(12);
  expect(junk.warnings[0]).toBe(
    "Previous OEM checkpoint is not a readable terminal census; reading every model page.",
  );
  if (cold.terminal.state.phase !== "complete" || !cold.terminal.state.census)
    throw new Error("Expected a terminal census");
  const foreign = OemCursor.checkpoint({
    ...cold.terminal,
    state: {
      ...cold.terminal.state,
      census: { ...cold.terminal.state.census, contract: "oem/older" },
    },
  });
  // A census without the arrival destinations it was accepted with is invalid.
  const accepted = cold.terminal.state.census;
  expect(() =>
    OemCursor.checkpoint({
      ...cold.terminal,
      state: { phase: "complete", census: accepted },
    }),
  ).toThrow("stored together");
  const contract = await census(native, 601, stored(foreign));
  expect(contract.models).toHaveLength(12);
  expect(contract.warnings[0]).toContain(
    "another parser or traversal contract",
  );
  const future = await census(native, 599, cold.wire);
  expect(future.models).toHaveLength(12);
  expect(future.warnings[0]).toContain("dated after this run");
  // A pre-incremental terminal cursor stays readable and is a silent cold start.
  const legacy = OemCursor.checkpoint({
    ...cold.terminal,
    state: { phase: "complete" },
  });
  const silent = await census(native, 601, stored(legacy));
  expect(silent.models).toHaveLength(12);
  expect(silent.warnings).toEqual([
    "OEM Read 12 of 12 model pages (cold 12); carried 0.",
  ]);
});

test("OEM carries unread models, rotates the sweep and reads count changes", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // First day with a non-empty slice: only that slice (slice(key) === day % 6)
  // is read.
  const first = dayAfterCold((day) => sweep(day).length > 0);
  expect(sweep(first).length).toBeGreaterThan(0);
  const next = await census(native, first, cold.wire);
  expect(next.models).toEqual(sweep(first));
  expect(next.requests).toBe(4 + sweep(first).length);
  expect(next.terminal.requests).toBe(4 + sweep(first).length);
  // Carried donors are still published in full.
  expect(next.vins).toEqual(allVins(native));

  // The next non-empty slice is a different set of models.
  const second = dayAfterCold((day) => sweep(day).length > 0, first + 1);
  expect(sweep(second).length).toBeGreaterThan(0);
  expect(sweep(second)).not.toEqual(sweep(first));
  // A sold donor changes one unswept model's badge and so the make badge. Only
  // that model is read for it; its siblings keep carrying.
  const sold = pickModel((m) => !sweep(second).includes(m));
  native.rows.set(sold, donors(sold, 39));
  const changed = await census(native, second, next.wire);
  expect(changed.models).toEqual(sorted([...sweep(second), sold]));
  expect(changed.vins).toEqual(allVins(native));
  expect(changed.warnings.at(-1)).toBe(
    summary([
      ["sweep", sweep(second)],
      ["count", [sold]],
    ]),
  );
});

test("OEM arrivals publish lagging donors without triggering model reads", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // A day with a non-empty slice that leaves M0 unswept, and an arrival model
  // it leaves unswept.
  const day = dayAfterCold((d) => sweep(d).length > 0 && !sweep(d).includes(0));
  expect(sweep(day).length).toBeGreaterThan(0);
  const lagging = pickModel((m) => !sweep(day).includes(m));
  // The arrival is not on its model page yet (model pages lag arrivals).
  const arrival = donor(lagging, 41);
  native.setArrivals([arrival]);
  const run = await census(native, day, cold.wire);
  // M0 is not read either: its departed arrival is on its carried page.
  expect(run.models).toEqual(sweep(day));
  expect(run.models).not.toContain(lagging);
  expect(run.models).not.toContain(0);
  expect(run.vins).toEqual(allVins(native, [arrival]));
});

test("OEM reads a model once when a departing arrival is missing from its carried page", async () => {
  const native = yard();
  // Model M stays out of the sweep on days 601 to 603, so only the trigger
  // can read it.
  const m = pickModel((model) =>
    [601, 602, 603].every((day) => !sweep(day).includes(model)),
  );
  // Day 600: the M badge already counts arrival X, but its page lags.
  const x = donor(m, 41);
  native.badges.set(m, 41);
  native.setArrivals([x]);
  const cold = await census(native, 600, null);
  expect(cold.vins).toEqual(allVins(native, [x]));
  // Day 601: the page lists X with the badge unchanged, so M carries the
  // day-600 page without X; the arrivals page still publishes X.
  native.rows.set(m, donors(m, 41));
  const lagging = await census(native, 601, cold.wire);
  expect(lagging.models).toEqual(sweep(601));
  expect(lagging.vins).toEqual(allVins(native));
  // Day 602: X leaves the arrivals page. Its own destination binds M and the
  // carried page lacks it, so M is read and X stays published.
  native.setArrivals([donor(0, 1)]);
  const departed = await census(native, 602, lagging.wire);
  expect(departed.models).toEqual(sorted([...sweep(602), m]));
  expect(departed.vins).toEqual(allVins(native));
  expect(departed.warnings.at(-1)).toBe(
    summary([
      ["sweep", sweep(602)],
      ["trigger", [m]],
    ]),
  );
  // Day 603: the trigger fired once; M now carries its page with X.
  const after = await census(native, 603, departed.wire);
  expect(after.models).toEqual(sweep(603));
  expect(after.vins).toEqual(allVins(native));
});

test("OEM departing arrivals trigger one read even while the page still lags", async () => {
  const native = yard();
  // Model M stays out of the sweep on days 601 and 602.
  const m = pickModel((model) =>
    [601, 602].every((day) => !sweep(day).includes(model)),
  );
  const x = donor(m, 41);
  native.badges.set(m, 41);
  native.setArrivals([x]);
  const cold = await census(native, 600, null);
  // X leaves arrivals before reaching its page: one read, then no re-reads.
  native.setArrivals([donor(0, 1)]);
  const departed = await census(native, 601, cold.wire);
  // M still shows 40 cards under its 41 badge, so closing confirms its page.
  expect(departed.models).toEqual([...sorted([...sweep(601), m]), m]);
  expect(departed.warnings.at(-1)).toBe(
    summary([
      ["sweep", sweep(601)],
      ["trigger", [m]],
    ]),
  );
  const after = await census(native, 602, departed.wire);
  expect(after.models).toEqual(sweep(602));
});

test("OEM re-reads every model within six days, even across missed runs", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // Skip days 601 and 602 entirely: the gap makes day 603 read every model.
  const gap = await census(native, 603, cold.wire);
  expect(gap.models).toEqual(MODELS);
  // Arrivals, makes, one menu, 12 models and the closing make directory.
  expect(gap.requests).toBe(16);
  expect(gap.vins).toEqual(allVins(native));
  expect(gap.warnings.at(-1)).toBe(summary([["gap", MODELS]]));
  let previous = gap.wire;
  const lastRead = new Map<number, number>();
  for (const model of MODELS) lastRead.set(model, 603);
  let aged = 0;
  // Daily runs then resume incrementally.
  for (const day of [604, 605, 606, 607, 608, 609, 610, 611, 612]) {
    // Today's slice plus every model whose evidence reached the age ceiling.
    const stale = MODELS.filter((m) => day - (lastRead.get(m) ?? day) >= 6);
    const swept = sweep(day).filter((m) => !stale.includes(m));
    aged += stale.filter((m) => !sweep(day).includes(m)).length;
    const run = await census(native, day, previous);
    expect(run.models).toEqual(sorted([...swept, ...stale]));
    expect(run.warnings.at(-1)).toBe(
      summary([
        ["stale", stale],
        ["sweep", swept],
      ]),
    );
    for (const model of run.models) lastRead.set(model, day);
    for (const read of lastRead.values()) expect(day - read).toBeLessThan(6);
    expect(run.vins).toEqual(allVins(native));
    previous = run.wire;
  }
  // The gap read refreshed every model on day 603, and the daily sweep
  // reaches each again before its evidence ages to the ceiling.
  expect(aged).toBe(0);
  // Eleven resumable runs revalidate every checkpoint.
}, 30_000);

test("OEM rejects a checkpoint whose carried page differs from its census", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // A day whose first swept model follows M0, so M0 and every model before the
  // first due one carry.
  const day = dayAfterCold((d) => (sweep(d)[0] ?? 0) > 0);
  const due = sweep(day)[0];
  if (due === undefined) throw new Error("Expected a swept model");
  // Arrivals, makes and the menu fill the budget before the first due model,
  // so the paused cursor already holds the carried pages before it.
  const paused = await Effect.runPromise(
    streamOemInventory({
      startCursor: OemCursor.initial(),
      previousCursor: cold.wire,
      now: () => day * MODEL_CENSUS_DAY_MS,
      maxPages: 3,
      location,
      minimumUniqueInventory: 400,
      previousUniqueInventory: null,
      readPage: native.readPage,
      onBatch: () => Effect.void,
    }),
  );
  const state = paused.cursor.state;
  if (state.phase !== "models") throw new Error("Expected a models checkpoint");
  expect(state.pages).toHaveLength(due);
  expect(paused.cursor.requests).toBe(3);
  const [carried] = state.pages;
  if (!carried) throw new Error("Expected a carried page");
  expect(() =>
    OemCursor.checkpoint({
      ...paused.cursor,
      state: {
        ...state,
        pages: [
          {
            ...carried,
            records: carried.records.map((record, index) =>
              index === 0
                ? {
                    ...record,
                    fields: record.fields.filter((f) => f.label !== "vin"),
                  }
                : record,
            ),
          },
        ],
      },
    }),
  ).toThrow("carried model page differs");
  // Counting a carried page as a request is also rejected.
  expect(() => OemCursor.checkpoint({ ...paused.cursor, requests: 4 })).toThrow(
    "accounting does not reconcile",
  );
});

test("OEM fails a run whose read and carried cards fall short of today's model badges", async () => {
  // Badges overstate cards as they do natively (about 89% covered). A site
  // fault then renders today's swept pages as explicit empties while the
  // menus keep their badges. Carried pages keep the inventory floor
  // satisfied, so only the badge coverage check catches the first broken day.
  const native = yard();
  for (const model of MODELS) native.badges.set(model, 45);
  const cold = await census(native, 600, null);
  expect(cold.vins).toEqual(allVins(native));
  const day = dayAfterCold((d) => sweep(d).length > 0);
  for (const model of sweep(day)) native.broken.add(model);
  let published = 0;
  await expect(
    (async () => {
      let cursor: unknown = OemCursor.initial();
      for (;;) {
        const result = await Effect.runPromise(
          streamOemInventory({
            startCursor: cursor,
            previousCursor: cold.wire,
            now: () => day * MODEL_CENSUS_DAY_MS,
            maxPages: 8,
            location,
            minimumUniqueInventory: 400,
            previousUniqueInventory: cold.vins.length,
            readPage: native.readPage,
            onBatch: (batch) =>
              Effect.sync(() => {
                published += batch.length;
              }),
          }),
        );
        if (result.status === "complete") return;
        cursor = result.cursor;
      }
    })(),
  ).rejects.toThrow("coverage floor");
  expect(published).toBe(0);
});

test("OEM confirms an explicit empty model under a nonzero badge and carries it", async () => {
  // Native explicit empties under nonzero badges are accepted (23 such models
  // on November 15). Closing re-reads the empty page, so its evidence is
  // confirmed and the next run carries it instead of reading it as short.
  const native = yard();
  const empty = pickModel((m) => !sweep(601).includes(m));
  native.rows.set(empty, []);
  native.badges.set(empty, 3);
  const cold = await census(native, 600, null);
  expect(cold.models).toEqual([...MODELS, empty]);
  expect(cold.vins).toEqual(allVins(native));
  if (cold.terminal.state.phase !== "complete" || !cold.terminal.state.census)
    throw new Error("Expected a terminal census");
  const evidence = cold.terminal.state.census.models;
  expect(evidence[empty]).toMatchObject({
    count: 3,
    confirmed: true,
    page: { nativeEmpty: true, records: [] },
  });
  expect(evidence.filter((m) => m.confirmed)).toHaveLength(1);
  const next = await census(native, 601, cold.wire);
  expect(next.models).toEqual(sweep(601));
  expect(next.vins).toEqual(allVins(native));
  expect(next.warnings.at(-1)).toBe(summary([["sweep", sweep(601)]]));
});

/** Runs chunks seeded by `previousCursor` on `day` until the run completes or
 * fails, counting every published vehicle. */
async function attemptRun(
  native: ReturnType<typeof yard>,
  day: number,
  previousCursor: unknown,
  previousUniqueInventory: number,
  published: { count: number },
) {
  let cursor: unknown = OemCursor.initial();
  for (;;) {
    const result = await Effect.runPromise(
      streamOemInventory({
        startCursor: cursor,
        previousCursor,
        now: () => day * MODEL_CENSUS_DAY_MS,
        maxPages: 8,
        location,
        minimumUniqueInventory: 400,
        previousUniqueInventory,
        readPage: native.readPage,
        onBatch: (batch) =>
          Effect.sync(() => {
            published.count += batch.length;
          }),
      }),
    );
    if (result.status === "complete") return;
    cursor = result.cursor;
  }
}

test("OEM fails an incremental run whose swept pages list one card each while badges hold", async () => {
  // Badges overstate cards as they do natively (480 cards under 528 badges,
  // 90.9%). A fault then renders today's one swept page with a single card
  // while its menu badge holds: 441 of 528 badges (83.5%) still clears the 82%
  // badge floor, so only the replay floor (441 of the last accepted 480 cards)
  // catches it. The real November 15 census loses 9.7% to 18.2% of its cards
  // per slice cut this way.
  const native = yard();
  for (const model of MODELS) native.badges.set(model, 44);
  const cold = await census(native, 600, null);
  expect(cold.vins).toEqual(allVins(native));
  const day = dayAfterCold((d) => sweep(d).length === 1);
  for (const model of sweep(day)) native.cut.add(model);
  const published = { count: 0 };
  await expect(
    attemptRun(native, day, cold.wire, cold.vins.length, published),
  ).rejects.toThrow(
    "list 441 of 480 cards that the last accepted census listed, less any drop in their counts, below the 97% coverage floor",
  );
  expect(published.count).toBe(0);
});

test("OEM fails a steady-state run whose routine sweep page, read at age six, lists one card", async () => {
  // After the first cycle every routine sweep read happens at age exactly six
  // (reason stale). With badges overstating cards (480 under 528), ten healthy
  // daily runs and then one swept page cut to a single card: 441 of 528
  // badges clears the 82% badge floor, so the replay floor must still see the
  // age-six read and reject the run before anything is published.
  const native = yard();
  for (const model of MODELS) native.badges.set(model, 44);
  let previous = (await census(native, 600, null)).wire;
  for (let day = 601; day <= 610; day++) {
    const run = await census(native, day, previous);
    expect(run.vins).toEqual(allVins(native));
    previous = run.wire;
  }
  const day = [611, 612, 613, 614, 615, 616].find((d) => sweep(d).length === 1);
  if (day === undefined)
    throw new Error("fixture needs a steady day that sweeps one model");
  for (const model of sweep(day)) native.cut.add(model);
  const published = { count: 0 };
  await expect(
    attemptRun(native, day, previous, allVins(native).length, published),
  ).rejects.toThrow(
    "list 441 of 480 cards that the last accepted census listed, less any drop in their counts, below the 97% coverage floor",
  );
  expect(published.count).toBe(0);
}, 120_000);

test("OEM re-reads a surplus page that lost donors down to its unchanged badge", async () => {
  // A model page lists 40 cards under a badge of 38 (placeholder or surplus
  // rows). On its sweep day it loses two real donors and lists exactly 38, so
  // its cards match its badge. Its expected count stays 40: closing re-reads
  // it, its evidence is not confirmed, and the next run reads it again instead
  // of carrying the shrunken page for up to six days.
  const native = yard();
  const day = dayAfterCold(
    (d) =>
      sweep(d).some((m) => m !== 0) &&
      d + 1 < 600 + MODEL_CENSUS_SWEEP_DAYS &&
      sweep(d + 1).length > 0,
  );
  const m = pickModel(
    (model) => sweep(day).includes(model) && !sweep(day + 1).includes(model),
  );
  native.badges.set(m, 38);
  const cold = await census(native, 600, null);
  expect(cold.vins).toEqual(allVins(native));
  native.rows.set(m, donors(m, 38));
  const shrunk = await census(native, day, cold.wire);
  expect(shrunk.models).toEqual([...sweep(day), m]);
  if (
    shrunk.terminal.state.phase !== "complete" ||
    !shrunk.terminal.state.census
  )
    throw new Error("Expected a terminal census");
  expect(shrunk.terminal.state.census.models[m]).toMatchObject({
    count: 38,
    readDay: day,
    expected: 40,
    confirmed: false,
  });
  // The re-read matches its badge and the 38 cards the previous run read, so
  // closing does not repeat it.
  const next = await census(native, day + 1, shrunk.wire);
  expect(next.models).toEqual(sorted([...sweep(day + 1), m]));
  expect(next.warnings.at(-1)).toBe(
    summary([
      ["sweep", sweep(day + 1)],
      ["short", [m]],
    ]),
  );
});

import { expect, test } from "bun:test";
import { Effect } from "effect";
import { serializeDurableSourceCursor } from "./durable-cursor";
import { MODEL_CENSUS_DAY_MS, MODEL_CENSUS_SWEEP_DAYS } from "./model-census";
import { streamOemInventory } from "./oem-connector";
import { OemCursor, OemCursorSchema } from "./oem-cursor";
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
/** Fixture models other than `except`, in menu order. */
const others = (...except: number[]) =>
  MODELS.filter((m) => !except.includes(m));
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
}, 30_000);

test("OEM reads every model page daily after an accepted census and labels count changes", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // The next day's incremental run still reads every model page, so its
  // request accounting matches a full read.
  const next = await census(native, 601, cold.wire);
  expect(next.models).toEqual(MODELS);
  // Arrivals, makes, one menu, 12 models and the closing make directory.
  expect(next.requests).toBe(16);
  expect(next.terminal.requests).toBe(16);
  expect(next.vins).toEqual(allVins(native));
  expect(next.warnings.at(-1)).toBe(summary([["daily", MODELS]]));
  expect(next.warnings.at(-1)).toBe(
    "OEM Read 12 of 12 model pages (daily 12); carried 0.",
  );

  // A sold donor changes one model's badge and so the make badge. That model
  // is labelled as a count change; every other model is still read.
  const sold = 5;
  native.rows.set(sold, donors(sold, 39));
  const changed = await census(native, 602, next.wire);
  expect(changed.models).toEqual(MODELS);
  expect(changed.requests).toBe(16);
  expect(changed.vins).toEqual(allVins(native));
  expect(changed.warnings.at(-1)).toBe(
    summary([
      ["daily", others(sold)],
      ["count", [sold]],
    ]),
  );
}, 30_000);

test("OEM reads a page whose donor was replaced under an unchanged badge", async () => {
  // One donor is crushed and another placed under the same model: the badge
  // and every menu count stay the same. Badge-only reuse would have carried
  // the old page; the daily read publishes the new donor and drops the old.
  const native = yard();
  const m = 5;
  const cold = await census(native, 600, null);
  const crushed = donor(m, 40);
  const placed = donor(m, 41);
  expect(cold.vins).toContain(crushed.vin);
  native.rows.set(m, [...donors(m, 39), placed]);
  const swapped = await census(native, 601, cold.wire);
  expect(swapped.models).toEqual(MODELS);
  expect(swapped.requests).toBe(16);
  expect(swapped.warnings.at(-1)).toBe(summary([["daily", MODELS]]));
  expect(swapped.vins).toContain(placed.vin);
  expect(swapped.vins).not.toContain(crushed.vin);
  expect(swapped.vins).toEqual(allVins(native));
  if (
    swapped.terminal.state.phase !== "complete" ||
    !swapped.terminal.state.census
  )
    throw new Error("Expected a terminal census");
  const evidence = swapped.terminal.state.census.models[m];
  expect(evidence).toMatchObject({ count: 40, readDay: 601 });
  expect(
    evidence?.page.records.some((r) =>
      r.fields.some((f) => f.label === "vin" && f.value === placed.vin),
    ),
  ).toBe(true);
}, 30_000);

test("OEM arrivals publish lagging donors without triggering model reads", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const lagging = 5;
  // The arrival is not on its model page yet (model pages lag arrivals).
  const arrival = donor(lagging, 41);
  native.setArrivals([arrival]);
  const run = await census(native, 601, cold.wire);
  // Every page is read, and neither the current arrival nor M0's departed
  // arrival (on its last accepted page) labels a trigger.
  expect(run.models).toEqual(MODELS);
  expect(run.warnings.at(-1)).toBe(summary([["daily", MODELS]]));
  expect(run.vins).toEqual(allVins(native, [arrival]));
});

test("OEM labels a trigger once when a departing arrival is missing from its last accepted page", async () => {
  const native = yard();
  const m = 5;
  // Day 600: the M badge already counts arrival X, but its page lags. A cold
  // run confirms no short page.
  const x = donor(m, 41);
  native.badges.set(m, 41);
  native.setArrivals([x]);
  const cold = await census(native, 600, null);
  expect(cold.vins).toEqual(allVins(native, [x]));
  if (cold.terminal.state.phase !== "complete" || !cold.terminal.state.census)
    throw new Error("Expected a terminal census");
  expect(cold.terminal.state.census.models[m]).toMatchObject({
    count: 41,
    readDay: 600,
    confirmed: false,
  });
  // Day 601: the first incremental run reads the short M page and its
  // closing re-reads it identically, so this run confirms it.
  const confirming = await census(native, 601, cold.wire);
  expect(confirming.models).toEqual([...MODELS, m]);
  // A full read plus the closing re-read of M.
  expect(confirming.requests).toBe(17);
  expect(confirming.vins).toEqual(allVins(native, [x]));
  expect(confirming.warnings.at(-1)).toBe(
    summary([
      ["daily", others(m)],
      ["short", [m]],
    ]),
  );
  if (
    confirming.terminal.state.phase !== "complete" ||
    !confirming.terminal.state.census
  )
    throw new Error("Expected a terminal census");
  expect(confirming.terminal.state.census.models[m]).toMatchObject({
    count: 41,
    readDay: 601,
    confirmed: true,
  });
  // Day 602: the page still lags under the same badge. It is read again
  // (confirmed, so labelled daily) and closing re-reads it, since its cards
  // differ from its badge.
  const lagging = await census(native, 602, confirming.wire);
  expect(lagging.models).toEqual([...MODELS, m]);
  expect(lagging.vins).toEqual(allVins(native, [x]));
  expect(lagging.warnings.at(-1)).toBe(summary([["daily", MODELS]]));
  // Day 603: X reaches its page and leaves the arrivals page the same day.
  // Its own destination binds M and the last accepted page lacks it, so M's
  // read is labelled a trigger, and X stays published from the page.
  native.rows.set(m, donors(m, 41));
  native.setArrivals([donor(0, 1)]);
  const departed = await census(native, 603, lagging.wire);
  expect(departed.models).toEqual(MODELS);
  expect(departed.requests).toBe(16);
  expect(departed.vins).toEqual(allVins(native));
  expect(departed.vins).toContain(x.vin);
  expect(departed.warnings.at(-1)).toBe(
    summary([
      ["daily", others(m)],
      ["trigger", [m]],
    ]),
  );
  // Day 604: the trigger fired once; M is read daily with X on its page.
  const after = await census(native, 604, departed.wire);
  expect(after.models).toEqual(MODELS);
  expect(after.vins).toEqual(allVins(native));
  expect(after.warnings.at(-1)).toBe(summary([["daily", MODELS]]));
}, 30_000);

test("OEM departing arrivals trigger one read even while the page still lags", async () => {
  const native = yard();
  const m = 5;
  const x = donor(m, 41);
  native.badges.set(m, 41);
  native.setArrivals([x]);
  const cold = await census(native, 600, null);
  // X leaves arrivals before reaching its page: one trigger, then none.
  native.setArrivals([donor(0, 1)]);
  const departed = await census(native, 601, cold.wire);
  // M still shows 40 cards under its 41 badge, so closing confirms its page.
  expect(departed.models).toEqual([...MODELS, m]);
  expect(departed.warnings.at(-1)).toBe(
    summary([
      ["daily", others(m)],
      ["trigger", [m]],
    ]),
  );
  const after = await census(native, 602, departed.wire);
  // M is read again (closing re-reads its short page), but not as a trigger.
  expect(after.models).toEqual([...MODELS, m]);
  expect(after.warnings.at(-1)).toBe(summary([["daily", MODELS]]));
}, 30_000);

test("OEM reads every model after missed runs and on every following day", async () => {
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
  // Daily runs then resume incrementally, and each reads every model page.
  for (const day of [604, 605, 606, 607, 608, 609, 610, 611, 612]) {
    const run = await census(native, day, previous);
    expect(run.models).toEqual(MODELS);
    expect(run.requests).toBe(16);
    expect(run.warnings.at(-1)).toBe(summary([["daily", MODELS]]));
    if (run.terminal.state.phase !== "complete" || !run.terminal.state.census)
      throw new Error("Expected a terminal census");
    expect(
      run.terminal.state.census.models.every((m) => m.readDay === day),
    ).toBe(true);
    expect(run.vins).toEqual(allVins(native));
    previous = run.wire;
  }
  // Eleven resumable runs revalidate every checkpoint.
}, 30_000);

test("OEM rejects a checkpoint that counts a model page as free", async () => {
  // Every model page is a native read, so a paused incremental checkpoint
  // counts one request per page it holds.
  const native = yard();
  const cold = await census(native, 600, null);
  const day = 601;
  // Arrivals, makes, the menu and the first two model pages fill the budget.
  const paused = await Effect.runPromise(
    streamOemInventory({
      startCursor: OemCursor.initial(),
      previousCursor: cold.wire,
      now: () => day * MODEL_CENSUS_DAY_MS,
      maxPages: 5,
      location,
      minimumUniqueInventory: 400,
      previousUniqueInventory: null,
      readPage: native.readPage,
      onBatch: () => Effect.void,
    }),
  );
  const state = paused.cursor.state;
  if (state.phase !== "models") throw new Error("Expected a models checkpoint");
  expect(state.pages).toHaveLength(2);
  expect(paused.cursor.requests).toBe(5);
  // The checkpoint validates as it stands.
  expect(OemCursorSchema.safeParse(paused.cursor).success).toBe(true);
  // Claiming a held page cost no request (as a carried page once did) is
  // rejected, and so is counting one more request than was made.
  expect(() => OemCursor.checkpoint({ ...paused.cursor, requests: 4 })).toThrow(
    "accounting does not reconcile",
  );
  expect(() => OemCursor.checkpoint({ ...paused.cursor, requests: 6 })).toThrow(
    "accounting does not reconcile",
  );
});

test("OEM fails a daily run whose read cards fall short of today's model badges", async () => {
  // Badges overstate cards as they do natively (480 cards under 540 badges,
  // about 89% covered). A site fault then renders one model page (M9) as an
  // explicit empty while the menus keep their badges. The other pages keep
  // the inventory floor satisfied, so only the coverage checks catch the
  // first broken day: 440 of 540 badges falls below the 82% badge floor.
  const native = yard();
  for (const model of MODELS) native.badges.set(model, 45);
  const cold = await census(native, 600, null);
  expect(cold.vins).toEqual(allVins(native));
  const day = 601;
  native.broken.add(9);
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
  ).rejects.toThrow(
    "list 440 of 540 cards promised by today's model counts, below the 82% coverage floor",
  );
  expect(published).toBe(0);
});

test("OEM confirms an explicit empty model under a nonzero badge and keeps reading it", async () => {
  // Native explicit empties under nonzero badges are accepted (23 such models
  // on November 15). A cold run's closing re-reads the empty page but confirms
  // nothing; the first incremental run reads it as short, its closing re-reads
  // it, so its evidence is confirmed. The next run reads it daily, and closing
  // re-reads it again because it still lists fewer cards than its badge.
  const native = yard();
  const empty = 1;
  native.rows.set(empty, []);
  native.badges.set(empty, 3);
  const cold = await census(native, 600, null);
  expect(cold.models).toEqual([...MODELS, empty]);
  expect(cold.vins).toEqual(allVins(native));
  if (cold.terminal.state.phase !== "complete" || !cold.terminal.state.census)
    throw new Error("Expected a terminal census");
  const coldEvidence = cold.terminal.state.census.models;
  expect(coldEvidence[empty]).toMatchObject({
    count: 3,
    readDay: 600,
    confirmed: false,
    page: { nativeEmpty: true, records: [] },
  });
  expect(coldEvidence.filter((m) => m.confirmed)).toHaveLength(0);
  const confirming = await census(native, 601, cold.wire);
  expect(confirming.models).toEqual([...MODELS, empty]);
  // Arrivals, makes, one menu, 12 model pages, the closing re-read and the
  // closing make directory.
  expect(confirming.requests).toBe(17);
  expect(confirming.vins).toEqual(allVins(native));
  expect(confirming.warnings.at(-1)).toBe(
    summary([
      ["daily", others(empty)],
      ["short", [empty]],
    ]),
  );
  if (
    confirming.terminal.state.phase !== "complete" ||
    !confirming.terminal.state.census
  )
    throw new Error("Expected a terminal census");
  const evidence = confirming.terminal.state.census.models;
  expect(evidence[empty]).toMatchObject({
    count: 3,
    readDay: 601,
    confirmed: true,
    page: { nativeEmpty: true, records: [] },
  });
  expect(evidence.filter((m) => m.confirmed)).toHaveLength(1);
  const next = await census(native, 602, confirming.wire);
  expect(next.models).toEqual([...MODELS, empty]);
  expect(next.requests).toBe(17);
  expect(next.vins).toEqual(allVins(native));
  expect(next.warnings.at(-1)).toBe(summary([["daily", MODELS]]));
  if (next.terminal.state.phase !== "complete" || !next.terminal.state.census)
    throw new Error("Expected a terminal census");
  expect(next.terminal.state.census.models[empty]).toMatchObject({
    count: 3,
    readDay: 602,
    confirmed: true,
    page: { nativeEmpty: true, records: [] },
  });
}, 30_000);

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

test("OEM fails an incremental run whose page lists one card while its badge holds", async () => {
  // Badges overstate cards as they do natively (480 cards under 528 badges,
  // 90.9%). A fault then renders one model page (M9) with a single card while
  // its menu badge holds: 441 of 528 badges (83.5%) still clears the 82%
  // badge floor, so only the replay floor (441 of the last accepted 480 cards)
  // catches it. The real November 15 census loses 9.7% to 18.2% of its cards
  // when a sixth of its model pages is cut this way.
  const native = yard();
  for (const model of MODELS) native.badges.set(model, 44);
  const cold = await census(native, 600, null);
  expect(cold.vins).toEqual(allVins(native));
  const day = 601;
  native.cut.add(9);
  const published = { count: 0 };
  await expect(
    attemptRun(native, day, cold.wire, cold.vins.length, published),
  ).rejects.toThrow(
    "list 441 of 480 cards that the last accepted census listed, less any drop in their counts, below the 97% coverage floor",
  );
  // The rejection holds the next day: the gap run reads every page again and
  // is still judged against the day-600 census.
  await expect(
    attemptRun(native, day + 1, cold.wire, cold.vins.length, published),
  ).rejects.toThrow(
    "list 441 of 480 cards that the last accepted census listed, less any drop in their counts, below the 97% coverage floor",
  );
  expect(published.count).toBe(0);
}, 30_000);

test("OEM fails a steady-state daily run whose page lists one card", async () => {
  // With badges overstating cards (480 under 528), ten healthy daily runs and
  // then one model page (M5) cut to a single card: 441 of 528 badges clears
  // the 82% badge floor, so the replay floor against the previous day's
  // accepted census must reject the run before anything is published.
  const native = yard();
  for (const model of MODELS) native.badges.set(model, 44);
  let previous = (await census(native, 600, null)).wire;
  for (let day = 601; day <= 610; day++) {
    const run = await census(native, day, previous);
    // Every page lists 40 of its 44 badge, so closing re-reads each one.
    expect(run.models).toEqual([...MODELS, ...MODELS]);
    expect(run.vins).toEqual(allVins(native));
    previous = run.wire;
  }
  const day = 611;
  native.cut.add(5);
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
  // rows). The cold run stores that surplus unconfirmed, so the first
  // incremental run reads M as short. There it has lost two real donors and
  // lists exactly 38, so its cards match its badge. Its surplus is sticky: it
  // stays expected at 40 and unconfirmed, closing re-reads it, its evidence
  // is not confirmed, and every following daily run labels it short (and
  // closing re-reads it) instead of accepting the shrunken page. Only a
  // normal incremental run six days after the first low read lowers the
  // surplus to what the page lists; after that it is read daily like the
  // rest, and closing still re-reads it while its 40-card ceiling stands.
  const native = yard();
  const day = 601;
  const m = 9;
  native.badges.set(m, 38);
  const cold = await census(native, 600, null);
  expect(cold.vins).toEqual(allVins(native));
  if (cold.terminal.state.phase !== "complete" || !cold.terminal.state.census)
    throw new Error("Expected a terminal census");
  expect(cold.terminal.state.census.models[m]).toMatchObject({
    count: 38,
    readDay: 600,
    expected: 40,
    lowSince: null,
    surplusConfirmed: false,
    confirmed: false,
  });
  // Every other cold page lists exactly its badge, so it has no surplus to
  // confirm.
  expect(
    cold.terminal.state.census.models
      .filter((evidence) => !evidence.surplusConfirmed)
      .map((evidence) => evidence.key),
  ).toEqual([modelKey(m)]);
  native.rows.set(m, donors(m, 38));
  const shrunk = await census(native, day, cold.wire);
  expect(shrunk.models).toEqual([...MODELS, m]);
  // Arrivals, makes, one menu, 12 model pages, M's closing re-read and the
  // closing make directory.
  expect(shrunk.requests).toBe(17);
  expect(shrunk.vins).toEqual(allVins(native));
  expect(shrunk.warnings.at(-1)).toBe(
    summary([
      ["daily", others(m)],
      ["short", [m]],
    ]),
  );
  if (
    shrunk.terminal.state.phase !== "complete" ||
    !shrunk.terminal.state.census
  )
    throw new Error("Expected a terminal census");
  expect(shrunk.terminal.state.census.models[m]).toMatchObject({
    count: 38,
    readDay: day,
    expected: 40,
    lowSince: day,
    surplusConfirmed: false,
    confirmed: false,
  });
  let previous = shrunk.wire;
  const lowered = day + MODEL_CENSUS_SWEEP_DAYS;
  for (let today = day + 1; today <= lowered + 2; today++) {
    // M is short through the lowering day; every other model is read daily.
    const short = today <= lowered ? [m] : [];
    const run = await census(native, today, previous);
    // Closing re-reads M whenever it lists fewer cards than the 40 expected,
    // and after the lowering whenever it lists fewer than its 40-card ceiling.
    expect(run.models).toEqual([...MODELS, m]);
    expect(run.requests).toBe(17);
    expect(run.vins).toEqual(allVins(native));
    expect(run.warnings.at(-1)).toBe(
      summary([
        ["daily", others(...short)],
        ["short", short],
      ]),
    );
    if (run.terminal.state.phase !== "complete" || !run.terminal.state.census)
      throw new Error("Expected a terminal census");
    expect(run.terminal.state.census.models[m]).toMatchObject(
      today < lowered
        ? // One re-read at the badge is not accepted as the new truth.
          {
            count: 38,
            readDay: today,
            expected: 40,
            lowSince: day,
            surplusConfirmed: false,
            confirmed: false,
          }
        : // Lowered on the lowering day, then read daily. With no surplus
          // left there is nothing to confirm; the lowered surplus stays as a
          // ceiling for closing re-reads.
          {
            count: 38,
            readDay: today,
            expected: 38,
            lowSince: null,
            ceiling: 2,
            ceilingSince: lowered,
            surplusConfirmed: true,
            confirmed: false,
          },
    );
    previous = run.wire;
  }
}, 60_000);

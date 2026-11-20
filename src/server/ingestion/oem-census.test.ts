import { expect, test } from "bun:test";
import { Effect } from "effect";
import { serializeDurableSourceCursor } from "./durable-cursor";
import { MODEL_CENSUS_DAY_MS } from "./model-census";
import { streamOemInventory } from "./oem-connector";
import { OemCursor } from "./oem-cursor";
import { OEM_ARRIVALS, OEM_MAKES, OEM_ORIGIN } from "./oem-html";
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

/** One make with twelve models of 40 donors each; `rows`, `badges` and the
 * arrivals can change between runs. A model badge defaults to its card count;
 * `badges` overrides it, since native badges also count donors that are not
 * on the model page yet. */
function yard() {
  const rows = new Map(Array.from({ length: 12 }, (_, i) => [i, donors(i)]));
  const badges = new Map<number, number>();
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
    if (model)
      return oemFixtureDocument(
        (rows.get(Number(model[1])) ?? []).map(card).join(""),
      );
    throw new Error("Unexpected request " + url);
  };
  return {
    rows,
    badges,
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
  expect(cold.terminal.state.census?.models).toHaveLength(12);
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
  // Day 601: only the sweep slice (ordinal % 6 === 601 % 6) is read.
  const next = await census(native, 601, cold.wire);
  expect(next.models).toEqual([1, 7]);
  expect(next.requests).toBe(6);
  expect(next.terminal.requests).toBe(6);
  // Carried donors are still published in full.
  expect(next.vins).toEqual(allVins(native));

  // Day 602: a sold donor changes model 4's badge and so the make badge. Only
  // model 4 is read for it; its siblings keep carrying.
  native.rows.set(4, donors(4, 39));
  const changed = await census(native, 602, next.wire);
  expect(changed.models).toEqual([2, 4, 8]);
  expect(changed.vins).toEqual(allVins(native));
  expect(changed.warnings.at(-1)).toBe(
    "OEM Read 3 of 12 model pages (sweep 2, count 1); carried 9.",
  );
});

test("OEM arrivals publish lagging donors without triggering model reads", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // The arrival is not on its model page yet (model pages lag arrivals).
  const arrival = donor(9, 41);
  native.setArrivals([arrival]);
  const run = await census(native, 601, cold.wire);
  // M0 is not read either: its departed arrival is on its carried page.
  expect(run.models).toEqual([1, 7]);
  expect(run.vins).toEqual(allVins(native, [arrival]));
});

test("OEM reads a model once when a departing arrival is missing from its carried page", async () => {
  const native = yard();
  // Day 600: the M10 badge already counts arrival X, but its page lags.
  const x = donor(10, 41);
  native.badges.set(10, 41);
  native.setArrivals([x]);
  const cold = await census(native, 600, null);
  expect(cold.vins).toEqual(allVins(native, [x]));
  // Day 601: the page lists X with the badge unchanged, so M10 carries the
  // day-600 page without X; the arrivals page still publishes X.
  native.rows.set(10, donors(10, 41));
  const lagging = await census(native, 601, cold.wire);
  expect(lagging.models).toEqual([1, 7]);
  expect(lagging.vins).toEqual(allVins(native));
  // Day 602: X leaves the arrivals page. Its own destination binds M10 and
  // the carried page lacks it, so M10 is read and X stays published.
  native.setArrivals([donor(0, 1)]);
  const departed = await census(native, 602, lagging.wire);
  expect(departed.models).toEqual([2, 8, 10]);
  expect(departed.vins).toEqual(allVins(native));
  expect(departed.warnings.at(-1)).toBe(
    "OEM Read 3 of 12 model pages (sweep 2, trigger 1); carried 9.",
  );
  // Day 603: the trigger fired once; M10 now carries its page with X.
  const after = await census(native, 603, departed.wire);
  expect(after.models).toEqual([3, 9]);
  expect(after.vins).toEqual(allVins(native));
});

test("OEM departing arrivals trigger one read even while the page still lags", async () => {
  const native = yard();
  const x = donor(10, 41);
  native.badges.set(10, 41);
  native.setArrivals([x]);
  const cold = await census(native, 600, null);
  // X leaves arrivals before reaching its page: one read, then no re-reads.
  native.setArrivals([donor(0, 1)]);
  const departed = await census(native, 601, cold.wire);
  expect(departed.models).toEqual([1, 7, 10]);
  const after = await census(native, 602, departed.wire);
  expect(after.models).toEqual([2, 8]);
});

test("OEM re-reads every model within six days, even across missed runs", async () => {
  const native = yard();
  let previous = (await census(native, 600, null)).wire;
  const lastRead = new Map<number, number>();
  for (let i = 0; i < 12; i++) lastRead.set(i, 600);
  // Skip days 601 and 602 entirely, then run daily.
  for (const day of [603, 604, 605, 606, 607, 608, 609, 610, 611, 612]) {
    const run = await census(native, day, previous);
    for (const model of run.models) lastRead.set(model, day);
    for (const read of lastRead.values()) expect(day - read).toBeLessThan(6);
    expect(run.vins).toEqual(allVins(native));
    // Day 606 also reads the four models that reached the age ceiling; after
    // that the sweep reads about a sixth of the models per day.
    expect(run.models).toHaveLength(day === 606 ? 6 : 2);
    previous = run.wire;
  }
  // Eleven resumable runs revalidate every checkpoint.
}, 30_000);

test("OEM rejects a checkpoint whose carried page differs from its census", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // Arrivals, makes and the menu: models 0 and 1 are read on day 601 (0 is
  // carried, 1 is due), so the paused cursor already holds carried page 0.
  const paused = await Effect.runPromise(
    streamOemInventory({
      startCursor: OemCursor.initial(),
      previousCursor: cold.wire,
      now: () => 601 * MODEL_CENSUS_DAY_MS,
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
  expect(state.pages).toHaveLength(1);
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

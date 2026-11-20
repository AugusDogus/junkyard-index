import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamChazInventoryWithRequestGate } from "./chaz-connector";
import { ChazCursor } from "./chaz-cursor";
import { chazHash, type ChazControl, type ChazRecord } from "./chaz-parser";
import {
  CHAZ_CONTACT,
  CHAZ_MAKES,
  CHAZ_ORIGIN,
  CHAZ_ROOT,
} from "./chaz-yard-metadata";
import {
  chazFixtureContact,
  chazFixtureDirectory,
  chazFixtureModelPage,
  chazFixtureRoot,
} from "./chaz-test-fixtures";
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
// A run day on a sweep boundary, so day D + k sweeps the models in slice k.
const D = 6 * Math.floor(ModelCensus.day(Date.parse("2026-11-01")) / 6);
const date = (day: number) =>
  new Date(day * MODEL_CENSUS_DAY_MS).toISOString().slice(0, 10);
const make: ChazControl = { path: "/parts/ACURA", label: "ACURA", count: 0 };
const label = (i: number) => "M" + i;
const record = (
  model: number,
  n: number,
  entered: string | null = null,
): ChazRecord => [
  "1HGCM82633A" + String(model * 1000 + n).padStart(6, "0"),
  "2003",
  "ACURA " + label(model),
  "ST" + model + "-" + n,
  `/parts/ACURA/${label(model)}/ST${model}-${n}/2003`,
  null,
  entered,
];
const donors = (model: number, n = 40) =>
  Array.from({ length: n }, (_, i) => record(model, i + 1));
const ids = (n: number) => Array.from({ length: n }, (_, i) => i);
/** The census key chazCensusControls builds for a fixture model. */
const key = (model: number) =>
  JSON.stringify([
    make.path,
    make.label,
    `/parts/ACURA/${label(model)}/`,
    label(model),
  ]);
/** Models among `models` whose sweep slice falls on `day`. */
const sweep = (day: number, models: readonly number[]) =>
  models.filter(
    (model) => ModelCensus.slice(key(model)) === day % MODEL_CENSUS_SWEEP_DAYS,
  );
/** Models swept on none of `days`, so a read on those days is never a sweep. */
const quiet = (days: readonly number[], models: readonly number[]) =>
  models.filter((model) => days.every((day) => !sweep(day, [model]).length));
/** Expected reads: the explicit reasons plus a sweep of every other model in
 * today's slice. */
const reads = (
  day: number,
  models: readonly number[],
  reasons: ReadonlyArray<readonly [number, string]>,
) => {
  const expected = new Map<number, string>(reasons);
  for (const model of sweep(day, models))
    if (!expected.has(model)) expected.set(model, "sweep");
  return new Map([...expected].sort(([a], [b]) => a - b));
};
/** The run summary for `expected`, with reasons in model order as planned. */
const summary = (total: number, expected: ReadonlyMap<number, string>) => {
  const counts = new Map<string, number>();
  for (const reason of expected.values())
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const reasons = [...counts].map(([reason, n]) => `${reason} ${n}`);
  return `Chaz Read ${expected.size} of ${total} model pages${reasons.length ? ` (${reasons.join(", ")})` : ""}; carried ${total - expected.size}.`;
};

/** Twelve models with 40 donors each (above the 354 floor); `rows` and the
 * arrival cards can change between runs. */
function yard() {
  const rows = new Map(Array.from({ length: 12 }, (_, i) => [i, donors(i)]));
  // Arrivals always list at least one card; this old donor is already on M0.
  let arrivals: ChazRecord[] = [record(0, 1, date(D - 20))];
  const urls: string[] = [];
  // Models whose page transiently answers with an explicit empty result while
  // the menu badge still counts its donors.
  const outages = new Set<number>();
  const models = () =>
    [...rows].map(
      ([i, list]): ChazControl => ({
        path: `/parts/ACURA/${label(i)}/`,
        label: label(i),
        count: list.length,
      }),
    );
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
      const model = /\/parts\/ACURA\/M(\d+)\/$/.exec(url);
      const body =
        url === CHAZ_CONTACT
          ? chazFixtureContact
          : url === CHAZ_ROOT
            ? chazFixtureRoot(arrivals)
            : url === CHAZ_MAKES
              ? chazFixtureDirectory([{ ...make, count: total }], "makes")
              : url === CHAZ_ORIGIN + make.path
                ? chazFixtureDirectory(models(), "models")
                : model
                  ? chazFixtureModelPage(
                      outages.has(Number(model[1]))
                        ? []
                        : (rows.get(Number(model[1])) ?? []),
                      `Used ACURA ${label(Number(model[1]))}`,
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
  return {
    rows,
    urls,
    outages,
    arrivals: () => arrivals,
    setArrivals: (next: ChazRecord[]) => {
      arrivals = next;
    },
  };
}

/** One full run on `day`, seeded by the previous terminal cursor. */
async function census(
  native: ReturnType<typeof yard>,
  day: number,
  previousCursor: unknown,
) {
  const before = native.urls.length;
  let cursor: ChazCursor = ChazCursor.initial;
  const vins: string[] = [];
  const warnings: string[] = [];
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamChazInventoryWithRequestGate(
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
    cursor = ChazCursor.parse(ChazCursor.serialize(result.cursor));
  }
  const models = native.urls
    .slice(before)
    .flatMap((url) => /\/parts\/ACURA\/M(\d+)\/$/.exec(url)?.[1] ?? [])
    .map(Number);
  return {
    terminal: JSON.parse(ChazCursor.serialize(cursor)) as unknown,
    requests: native.urls.length - before,
    models,
    vins: vins.sort(),
    warnings,
  };
}

/** Every model donor plus arrival-only donors, as the union publishes them. */
const allVins = (native: ReturnType<typeof yard>) =>
  [
    ...new Set(
      [...native.rows.values(), native.arrivals()].flat().map((r) => r[0]),
    ),
  ].sort();

test("Chaz cold start reads every model and publishes its census", async () => {
  const native = yard();
  const cold = await census(native, D, null);
  expect(cold.models).toEqual(Array.from({ length: 12 }, (_, i) => i));
  // contact, arrivals, makes, one menu, 12 models, closing contact and makes.
  expect(cold.requests).toBe(18);
  expect(cold.vins).toEqual(allVins(native));
  // A missing previous cursor is a silent cold start.
  expect(cold.warnings).toHaveLength(2);
  expect(cold.warnings.at(-1)).toBe(
    "Chaz Read 12 of 12 model pages (cold 12); carried 0.",
  );
  // A pre-incremental terminal cursor is also a silent cold start.
  const legacy = await census(native, D + 1, {
    source: "chaz",
    version: 1,
    phase: "complete",
  });
  expect(legacy.models).toHaveLength(12);
  expect(legacy.warnings).toHaveLength(2);
  // An unreadable previous checkpoint is a warned cold census, not a failure.
  const junk = await census(native, D + 1, { source: "chaz", junk: true });
  expect(junk.models).toHaveLength(12);
  expect(junk.warnings[0]).toBe(
    "Previous Chaz checkpoint is not a readable terminal census; reading every model page.",
  );
  // A census from another contract or from a later day is never adopted.
  const terminal = cold.terminal;
  if (
    typeof terminal !== "object" ||
    terminal === null ||
    !("census" in terminal) ||
    typeof terminal.census !== "object"
  )
    throw new Error("Expected a terminal census");
  const foreign = await census(native, D + 1, {
    ...terminal,
    census: { ...terminal.census, contract: "another-contract" },
  });
  expect(foreign.models).toHaveLength(12);
  expect(foreign.warnings[0]).toContain("another parser or traversal contract");
  const future = await census(native, D - 1, terminal);
  expect(future.models).toHaveLength(12);
  expect(future.warnings[0]).toContain("dated after this run");
});

test("Chaz carries unread models, rotates the sweep and reads changes", async () => {
  const native = yard();
  const twelve = ids(12);
  // The sweep rotates: D + 1 and D + 3 sweep different, non-empty slices.
  expect(sweep(D + 1, twelve).length).toBeGreaterThan(0);
  expect(sweep(D + 3, twelve).length).toBeGreaterThan(0);
  expect(sweep(D + 3, twelve)).not.toEqual(sweep(D + 1, twelve));
  // Changed models are swept on none of D + 2 to D + 4, so every read and
  // every carry asserted below comes from the change, not from the sweep.
  const [sold, swappedModel, excludedModel, staleModel] = quiet(
    [D + 2, D + 3, D + 4],
    twelve,
  );
  if (
    sold === undefined ||
    swappedModel === undefined ||
    excludedModel === undefined ||
    staleModel === undefined
  )
    throw new Error("Expected four models outside the D + 2 to D + 4 sweeps");
  const cold = await census(native, D, null);
  // Day D + 1: only the sweep slice (ModelCensus.slice(key) === day % 6) is read.
  const next = await census(native, D + 1, cold.terminal);
  expect(next.models).toEqual(sweep(D + 1, twelve));
  expect(next.requests).toBe(6 + sweep(D + 1, twelve).length);
  // Carried donors are still published in full.
  expect(next.vins).toEqual(allVins(native));

  // Day D + 2: a sold donor changes one model's count; on another a donor is
  // swapped for a fresh arrival at the same count, which only the arrival
  // reveals. A fresh arrival on a third model never reaches its model page,
  // and an arrival entered weeks ago on a fourth is missing too: neither page
  // changes.
  native.rows.set(sold, donors(sold, 39));
  const swapped = record(swappedModel, 41, date(D + 1));
  // Model cards carry no Enter Date; only the arrival card does.
  native.rows.set(swappedModel, [
    ...donors(swappedModel).slice(1),
    record(swappedModel, 41),
  ]);
  const excluded = record(excludedModel, 41, date(D + 1));
  const stale = record(staleModel, 41, date(D - 14));
  native.setArrivals([swapped, excluded, stale]);
  const changed = await census(native, D + 2, next.terminal);
  const changedReads = reads(D + 2, twelve, [
    [sold, "count"],
    [swappedModel, "trigger"],
    [excludedModel, "trigger"],
  ]);
  expect(changed.models).toEqual([...changedReads.keys()]);
  expect(changed.models).not.toContain(staleModel);
  // Arrival-only donors stay published through the arrival union.
  expect(changed.vins).toEqual(allVins(native));
  expect(changed.vins).toContain(excluded[0]);
  expect(changed.vins).toContain(stale[0]);
  expect(changed.warnings.at(-1)).toBe(summary(12, changedReads));

  // Day D + 3: the excluded arrival (entered the day before the previous run)
  // triggers once more; the swapped model now carries its arrival.
  const again = await census(native, D + 3, changed.terminal);
  const againReads = reads(D + 3, twelve, [[excludedModel, "trigger"]]);
  expect(again.models).toEqual([...againReads.keys()]);
  expect(again.models).not.toContain(swappedModel);
  expect(again.warnings.at(-1)).toBe(summary(12, againReads));

  // Day D + 4: the excluded arrival is now too old to trigger, and a newly
  // published model is read.
  native.rows.set(12, donors(12));
  const added = await census(native, D + 4, again.terminal);
  const addedReads = reads(D + 4, ids(13), [[12, "new"]]);
  expect(added.models).toEqual([...addedReads.keys()]);
  expect(added.models).not.toContain(excludedModel);
  expect(added.vins).toEqual(allVins(native));
  expect(added.warnings.at(-1)).toBe(summary(13, addedReads));
});

test("Chaz re-reads every model within six days, even across missed runs", async () => {
  const native = yard();
  let previous = (await census(native, D, null)).terminal;
  const lastRead = new Map<number, number>();
  for (let i = 0; i < 12; i++) lastRead.set(i, D);
  // Skip days D + 1 and D + 2 entirely, then run daily.
  for (let day = D + 3; day <= D + 12; day++) {
    const run = await census(native, day, previous);
    // Never a full census; the day after missed runs also reads stale models.
    expect(run.models.length).toBeLessThan(12);
    for (const model of run.models) lastRead.set(model, day);
    for (const read of lastRead.values()) expect(day - read).toBeLessThan(6);
    expect(run.vins).toEqual(allVins(native));
    previous = run.terminal;
  }
});

test("Chaz re-reads a model page whose cards disagree with its badge on the next run", async () => {
  const native = yard();
  const twelve = ids(12);
  // The outage model is in the D + 3 sweep slice, so it is read that day.
  const [down] = sweep(D + 3, twelve);
  if (down === undefined) throw new Error("Expected a model swept on D + 3");
  let previous = (await census(native, D, null)).terminal;
  for (const day of [D + 1, D + 2])
    previous = (await census(native, day, previous)).terminal;
  // Day D + 3: the model is in the sweep slice and answers with an explicit
  // empty page while its badge still counts 40. The run stays above the floor.
  native.outages.add(down);
  const outage = await census(native, D + 3, previous);
  expect(outage.models).toEqual(sweep(D + 3, twelve));
  expect(outage.vins).not.toContain(record(down, 1)[0]);
  // Day D + 4: the badge is unchanged, but the carried page disagrees with it,
  // so the model is read again; it is still empty.
  const persistent = await census(native, D + 4, outage.terminal);
  const persistentReads = reads(D + 4, twelve, [[down, "trigger"]]);
  expect(persistent.models).toEqual([...persistentReads.keys()]);
  expect(persistent.warnings.at(-1)).toBe(summary(12, persistentReads));
  // Day D + 5: the page recovers and its donors are published again.
  native.outages.delete(down);
  const recovered = await census(native, D + 5, persistent.terminal);
  expect(recovered.models).toEqual([
    ...reads(D + 5, twelve, [[down, "trigger"]]).keys(),
  ]);
  expect(recovered.vins).toEqual(allVins(native));
  // Day D + 6: the recovered page agrees with its badge and carries again.
  // The models read only by the cold run reach the six-day ceiling today.
  const settled = await census(native, D + 6, recovered.terminal);
  const unread = quiet([D + 1, D + 2, D + 3, D + 4, D + 5], twelve);
  expect(settled.models).toEqual(
    twelve.filter(
      (model) => unread.includes(model) || sweep(D + 6, [model]).length > 0,
    ),
  );
  expect(settled.models).not.toContain(down);
  expect(settled.vins).toEqual(allVins(native));
});

test("Chaz checkpoints reject carried pages, accounting and census days that disagree with the plan", async () => {
  const native = yard();
  const cold = await census(native, D, null);
  // Opening on the first day whose first swept model is not model 0: contact,
  // arrivals, makes, menu; the models before it carry and it is the next read.
  const firstSwept = (day: number) =>
    ids(12).findIndex((model) => sweep(day, [model]).length);
  const day = [1, 2, 3, 4, 5, 6]
    .map((offset) => D + offset)
    .find((candidate) => firstSwept(candidate) > 0);
  if (day === undefined)
    throw new Error("fixture needs a day whose first swept model is not M0");
  const firstRead = firstSwept(day);
  const opening = await Effect.runPromise(
    streamChazInventoryWithRequestGate(
      {
        previousCursor: cold.terminal,
        now: () => day * MODEL_CENSUS_DAY_MS,
        maxPages: 4,
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  const state = opening.cursor;
  if (state.phase !== "models") throw new Error("Expected a model checkpoint");
  expect(state.pages).toHaveLength(firstRead);
  expect(state.requests).toBe(4);
  const forged = [record(0, 99)];
  expect(() =>
    ChazCursor.checkpoint({
      ...state,
      pages: [
        { records: forged, hash: chazHash(forged) },
        ...state.pages.slice(1),
      ],
    }),
  ).toThrow("carried model page differs");
  expect(() => ChazCursor.checkpoint({ ...state, pages: [] })).toThrow(
    "not due for a read",
  );
  expect(() =>
    ChazCursor.checkpoint({ ...state, requests: state.requests + 1 }),
  ).toThrow("request accounting");
  expect(() => ChazCursor.checkpoint({ ...state, day: D - 1 })).toThrow(
    "previous census is inconsistent",
  );
  expect(() => ChazCursor.checkpoint({ ...state, day: null })).toThrow(
    "previous census is inconsistent",
  );
});

test("Chaz starts a warned cold census when a carried page fails its fingerprint", async () => {
  const native = yard();
  const cold = await census(native, D, null);
  const terminal = ChazCursor.parse(JSON.stringify(cold.terminal));
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
  const next = await census(native, D + 1, tampered);
  expect(next.models).toHaveLength(12);
  expect(next.warnings[0]).toContain("reading every model page");
  expect(next.vins).toEqual(allVins(native));
});

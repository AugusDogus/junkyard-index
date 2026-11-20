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
import { MODEL_CENSUS_DAY_MS, ModelCensus } from "./model-census";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
// A run day on a sweep boundary, so day D + k reads ordinals k and k + 6.
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

/** Twelve models with 40 donors each (above the 354 floor); `rows` and the
 * arrival cards can change between runs. */
function yard() {
  const rows = new Map(Array.from({ length: 12 }, (_, i) => [i, donors(i)]));
  // Arrivals always list at least one card; this old donor is already on M0.
  let arrivals: ChazRecord[] = [record(0, 1, date(D - 20))];
  const urls: string[] = [];
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
                      rows.get(Number(model[1])) ?? [],
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
  const cold = await census(native, D, null);
  // Day D + 1: only the sweep slice (ordinal % 6 === day % 6) is read.
  const next = await census(native, D + 1, cold.terminal);
  expect(next.models).toEqual([1, 7]);
  expect(next.requests).toBe(8);
  // Carried donors are still published in full.
  expect(next.vins).toEqual(allVins(native));

  // Day D + 2: a sold donor changes model 4's count; on model 9 a donor is
  // swapped for a fresh arrival at the same count, which only the arrival
  // reveals. A fresh arrival on model 5 never reaches its model page, and an
  // arrival entered weeks ago on model 3 is missing too: neither page changes.
  native.rows.set(4, donors(4, 39));
  const swapped = record(9, 41, date(D + 1));
  // Model cards carry no Enter Date; only the arrival card does.
  native.rows.set(9, [...donors(9).slice(1), record(9, 41)]);
  const excluded = record(5, 41, date(D + 1));
  const stale = record(3, 41, date(D - 14));
  native.setArrivals([swapped, excluded, stale]);
  const changed = await census(native, D + 2, next.terminal);
  expect(changed.models).toEqual([2, 4, 5, 8, 9]);
  // Arrival-only donors stay published through the arrival union.
  expect(changed.vins).toEqual(allVins(native));
  expect(changed.vins).toContain(excluded[0]);
  expect(changed.vins).toContain(stale[0]);
  expect(changed.warnings.at(-1)).toBe(
    "Chaz Read 5 of 12 model pages (sweep 2, count 1, trigger 2); carried 7.",
  );

  // Day D + 3: the excluded arrival (entered the day before the previous run)
  // triggers once more; model 9 now carries its arrival.
  const again = await census(native, D + 3, changed.terminal);
  expect(again.models).toEqual([3, 5, 9]);
  expect(again.warnings.at(-1)).toBe(
    "Chaz Read 3 of 12 model pages (sweep 2, trigger 1); carried 9.",
  );

  // Day D + 4: the excluded arrival is now too old to trigger, and a newly
  // published model is read.
  native.rows.set(12, donors(12));
  const added = await census(native, D + 4, again.terminal);
  expect(added.models).toEqual([4, 10, 12]);
  expect(added.vins).toEqual(allVins(native));
  expect(added.warnings.at(-1)).toBe(
    "Chaz Read 3 of 13 model pages (sweep 2, new 1); carried 10.",
  );
});

test("Chaz re-reads every model within six days, even across missed runs", async () => {
  const native = yard();
  let previous = (await census(native, D, null)).terminal;
  const lastRead = new Map<number, number>();
  for (let i = 0; i < 12; i++) lastRead.set(i, D);
  // Skip days D + 1 and D + 2 entirely, then run daily.
  for (let day = D + 3; day <= D + 12; day++) {
    const run = await census(native, day, previous);
    // About a sixth of the models per day, never all of them.
    expect(run.models.length).toBeLessThanOrEqual(6);
    for (const model of run.models) lastRead.set(model, day);
    for (const read of lastRead.values()) expect(day - read).toBeLessThan(6);
    expect(run.vins).toEqual(allVins(native));
    previous = run.terminal;
  }
});

test("Chaz checkpoints reject carried pages, accounting and census days that disagree with the plan", async () => {
  const native = yard();
  const cold = await census(native, D, null);
  // Day D + 1 opening: contact, arrivals, makes, menu; model 0 carries and
  // model 1 is the next read.
  const opening = await Effect.runPromise(
    streamChazInventoryWithRequestGate(
      {
        previousCursor: cold.terminal,
        now: () => (D + 1) * MODEL_CENSUS_DAY_MS,
        maxPages: 4,
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  const state = opening.cursor;
  if (state.phase !== "models") throw new Error("Expected a model checkpoint");
  expect(state.pages).toHaveLength(1);
  expect(state.requests).toBe(4);
  const forged = [record(0, 99)];
  expect(() =>
    ChazCursor.checkpoint({
      ...state,
      pages: [{ records: forged, hash: chazHash(forged) }],
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

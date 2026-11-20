import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  streamCentralInventoryWithRequestGate,
  type CentralStreamResult,
} from "./central-connector";
import { CentralCursor } from "./central-cursor";
import {
  centralHash,
  type CentralControl,
  type CentralRecord,
} from "./central-parser";
import {
  centralFixtureDirectory,
  centralFixtureMake,
  centralFixtureModelPage,
  centralFixtureRecord,
  centralFixtureRoot,
} from "./central-test-fixtures";
import {
  CENTRAL_MAKES,
  CENTRAL_ORIGIN,
  CENTRAL_ROOT,
} from "./central-yard-metadata";
import { MODEL_CENSUS_DAY_MS } from "./model-census";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const path = (i: number) => `${centralFixtureMake.path}/M${i}`;
const donors = (model: number, label: string, n = 170): CentralRecord[] =>
  Array.from({ length: n }, (_, i) =>
    centralFixtureRecord(model * 1000 + i + 1, label),
  );

/** Twelve models with 170 donors each (above the 1,985 floor); rows, labels
 * and badges can be edited between runs, and `once` serves a model page a
 * single time in place of its rows. */
function yard() {
  const labels = new Map(Array.from({ length: 12 }, (_, i) => [i, "M" + i]));
  const rows = new Map(
    Array.from({ length: 12 }, (_, i) => [i, donors(i, "M" + i)]),
  );
  const badges = new Map<number, number>();
  const once = new Map<number, CentralRecord[]>();
  const urls: string[] = [];
  const model = (i: number): CentralControl => ({
    path: path(i),
    label: labels.get(i) ?? "",
    count: badges.get(i) ?? rows.get(i)?.length ?? 0,
  });
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
      const index = /\/used-parts\/ACURA\/M(\d+)$/.exec(url);
      const served = index ? once.get(Number(index[1])) : undefined;
      if (index) once.delete(Number(index[1]));
      const body =
        url === CENTRAL_ROOT
          ? centralFixtureRoot
          : url === CENTRAL_MAKES
            ? centralFixtureDirectory(
                [{ ...centralFixtureMake, count: total }],
                "makes",
              )
            : url === CENTRAL_ORIGIN + centralFixtureMake.path
              ? centralFixtureDirectory([...rows.keys()].map(model), "models")
              : index
                ? centralFixtureModelPage(
                    served ?? rows.get(Number(index[1])) ?? [],
                    centralFixtureMake,
                    model(Number(index[1])),
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
  return { rows, labels, badges, once, urls };
}

/** One full run on `day`, seeded by the previous terminal cursor. */
async function census(
  native: ReturnType<typeof yard>,
  day: number,
  previousCursor: unknown,
) {
  const before = native.urls.length;
  let cursor: CentralCursor = CentralCursor.initial;
  const vins: string[] = [];
  const warnings: string[] = [];
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamCentralInventoryWithRequestGate(
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
    cursor = CentralCursor.parse(CentralCursor.serialize(result.cursor));
  }
  const models = native.urls
    .slice(before)
    .flatMap((url) => /\/used-parts\/ACURA\/M(\d+)$/.exec(url)?.[1] ?? [])
    .map(Number);
  const terminal: unknown = JSON.parse(CentralCursor.serialize(cursor));
  return {
    terminal,
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

test("Central cold start reads every model and publishes its census", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  expect(cold.models).toEqual(Array.from({ length: 12 }, (_, i) => i));
  // root, makes, one menu, 12 models, closing root and makes.
  expect(cold.requests).toBe(17);
  expect(cold.vins).toEqual(allVins(native));
  expect(cold.warnings).toHaveLength(2);
  expect(cold.warnings.at(-1)).toBe(
    "Central Read 12 of 12 model pages (cold 12); carried 0.",
  );
  // A pre-incremental terminal cursor is a silent cold start.
  const legacy = await census(native, 601, {
    source: "central",
    version: 1,
    phase: "complete",
  });
  expect(legacy.models).toHaveLength(12);
  expect(legacy.warnings).toHaveLength(2);
});

test("Central treats unreadable or incompatible previous cursors as a warned cold census", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const unreadable = await census(native, 601, { source: "central", junk: 1 });
  expect(unreadable.models).toHaveLength(12);
  expect(unreadable.warnings[0]).toBe(
    "Previous Central checkpoint is not a readable terminal census; reading every model page.",
  );
  if (
    typeof cold.terminal !== "object" ||
    cold.terminal === null ||
    !("census" in cold.terminal) ||
    typeof cold.terminal.census !== "object" ||
    cold.terminal.census === null
  )
    throw new Error("Expected a terminal census");
  const foreign = {
    ...cold.terminal,
    census: { ...cold.terminal.census, contract: "another contract" },
  };
  const incompatible = await census(native, 601, foreign);
  expect(incompatible.models).toHaveLength(12);
  expect(incompatible.warnings[0]).toContain("another parser or traversal");
  // A census dated after this run is never adopted.
  const future = await census(native, 599, cold.terminal);
  expect(future.models).toHaveLength(12);
  expect(future.warnings[0]).toContain("dated after this run");
  // A tampered carried page fails its card fingerprint and is not adopted.
  const tampered: unknown = JSON.parse(
    JSON.stringify(cold.terminal).replace("ACURA M3", "ACURA M4"),
  );
  const refused = await census(native, 601, tampered);
  expect(refused.models).toHaveLength(12);
  expect(refused.warnings[0]).toContain("not a readable terminal census");
});

test("Central carries unread models and reads count and label changes", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // Day 601: only the sweep slice (ordinal % 6 === 601 % 6) is read.
  const next = await census(native, 601, cold.terminal);
  expect(next.models).toEqual([1, 7]);
  // root, makes, one menu, two models, closing root and makes.
  expect(next.requests).toBe(7);
  // Carried donors are still published in full.
  expect(next.vins).toEqual(allVins(native));

  // Day 602: a sold donor changes model 4's count, and model 10 is relabelled
  // at the same path, so its carried cards no longer bind to the control.
  native.rows.set(4, donors(4, "M4", 169));
  native.labels.set(10, "MX");
  native.rows.set(10, donors(10, "MX"));
  const changed = await census(native, 602, next.terminal);
  expect(changed.models).toEqual([2, 4, 8, 10]);
  expect(changed.vins).toEqual(allVins(native));
  expect(changed.warnings.at(-1)).toBe(
    "Central Read 4 of 12 model pages (sweep 2, count 1, new 1); carried 8.",
  );
});

test("Central checkpoints refuse edited carried pages and unpaid carried reads", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  let cursor: CentralCursor = CentralCursor.initial;
  for (let chunk = 0; chunk < 2; chunk++) {
    const result: CentralStreamResult = await Effect.runPromise(
      streamCentralInventoryWithRequestGate(
        {
          startCursor: cursor,
          previousCursor: cold.terminal,
          now: () => 601 * MODEL_CENSUS_DAY_MS,
          maxPages: 3,
          onBatch: () => Effect.void,
        },
        gate,
      ),
    );
    cursor = result.cursor;
  }
  if (cursor.phase !== "closing") throw new Error("Expected a closing cursor");
  // Root, makes, menu and the two sweep models, then the closing root.
  expect(cursor.requests).toBe(6);
  expect(cursor.pages).toHaveLength(12);
  const state = cursor;
  const page = state.pages[0];
  if (!page) throw new Error("Expected a carried first page");
  const records = page.records.slice(1);
  const edited = { records, hash: centralHash(records) };
  expect(() =>
    CentralCursor.checkpoint({
      ...state,
      pages: [edited, ...state.pages.slice(1)],
    }),
  ).toThrow("carried model page differs");
  expect(() =>
    CentralCursor.checkpoint({ ...state, requests: state.requests + 1 }),
  ).toThrow("request accounting");
  expect(() => CentralCursor.checkpoint({ ...state, previous: null })).toThrow(
    "request accounting",
  );
});

test("Central re-reads every model within six days, even across missed runs", async () => {
  const native = yard();
  let previous = (await census(native, 600, null)).terminal;
  const lastRead = new Map<number, number>();
  for (let i = 0; i < 12; i++) lastRead.set(i, 600);
  // Skip day 601 and 602 entirely, then run daily.
  for (const day of [603, 604, 605, 606, 607, 608, 609, 610, 611, 612]) {
    const run = await census(native, day, previous);
    for (const model of run.models) lastRead.set(model, day);
    for (const read of lastRead.values()) expect(day - read).toBeLessThan(6);
    // Once the missed-run backlog is cleared, a sixth of the models per day.
    if (day >= 607) expect(run.models).toHaveLength(2);
    expect(run.vins).toEqual(allVins(native));
    previous = run.terminal;
  }
}, 60_000);

test("Central confirms read models whose cards differ from their badge before carrying them", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // Model 1 now shows 171 on its badge but keeps 170 cards on every read.
  native.badges.set(1, 171);
  const steady = await census(native, 601, cold.terminal);
  // Sweep model 7 plus the count change on model 1, then its closing re-read.
  expect(steady.models).toEqual([1, 7, 1]);
  // root, makes, one menu, two models, closing root, makes and model 1.
  expect(steady.requests).toBe(8);
  expect(steady.vins).toEqual(allVins(native));
  // Carried short evidence is not re-read at closing.
  const carried = await census(native, 602, steady.terminal);
  expect(carried.models).toEqual([2, 8]);

  // A short page on model 8's sweep day that does not repeat stops emission
  // instead of being carried for six days.
  native.once.set(8, donors(8, "M8", 120));
  await expect(census(native, 608, carried.terminal)).rejects.toThrow(
    "model cards changed",
  );
});

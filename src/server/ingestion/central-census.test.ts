import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  streamCentralInventoryWithRequestGate,
  type CentralStreamResult,
} from "./central-connector";
import { CentralCursor, type CentralCensus } from "./central-cursor";
import { validationRejectionKind } from "./ingestion-validation";
import { type CentralControl, type CentralRecord } from "./central-parser";
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
import { MODEL_CENSUS_DAY_MS, MODEL_CENSUS_SWEEP_DAYS } from "./model-census";

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

/** Twelve models with `size` donors each (170 by default, above the 1,985
 * floor); rows, labels and badges can be edited between runs, `once` serves a
 * model page a single time in place of its rows, and every page of a `broken`
 * model lists only its first card while the menus still count its rows. */
function yard(size = 170) {
  const labels = new Map(Array.from({ length: 12 }, (_, i) => [i, "M" + i]));
  const rows = new Map(
    Array.from({ length: 12 }, (_, i) => [i, donors(i, "M" + i, size)]),
  );
  const badges = new Map<number, number>();
  const once = new Map<number, CentralRecord[]>();
  const broken = new Set<number>();
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
                    served ??
                      (broken.has(Number(index[1]))
                        ? rows.get(Number(index[1]))?.slice(0, 1)
                        : rows.get(Number(index[1]))) ??
                      [],
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
  return { rows, labels, badges, once, broken, urls };
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

/** The census key Central builds for a fixture model (see
 * `centralCensusControls`). */
const censusKey = (i: number, label: string) =>
  JSON.stringify([
    centralFixtureMake.path,
    centralFixtureMake.label,
    path(i),
    label,
  ]);

/** Every fixture model in list order: each run reads all of them. */
const everyModel = Array.from({ length: 12 }, (_, i) => i);

/** The run summary for a full read, counting `reasons` in list order. */
const readSummary = (reasons: readonly string[]) => {
  const counts = new Map<string, number>();
  for (const reason of reasons)
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return `Central Read ${reasons.length} of ${reasons.length} model pages (${[
    ...counts,
  ]
    .map(([reason, n]) => `${reason} ${n}`)
    .join(", ")}); carried 0.`;
};

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
}, 30_000);

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
  // A tampered census page fails its card fingerprint and is not adopted.
  const tampered: unknown = JSON.parse(
    JSON.stringify(cold.terminal).replace("ACURA M3", "ACURA M4"),
  );
  const refused = await census(native, 601, tampered);
  expect(refused.models).toHaveLength(12);
  expect(refused.warnings[0]).toContain("not a readable terminal census");
}, 30_000);

test("Central reads every model daily and names count and label changes", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // An incremental run after an accepted census reads every model page.
  const next = await census(native, 601, cold.terminal);
  expect(next.models).toEqual(everyModel);
  // The same requests as a full read: root, makes, one menu, 12 models,
  // closing root and makes.
  expect(next.requests).toBe(cold.requests);
  expect(next.requests).toBe(17);
  expect(next.vins).toEqual(allVins(native));
  expect(next.warnings.at(-1)).toBe(readSummary(everyModel.map(() => "daily")));

  // A sold donor changes one model's count, and another model is relabelled
  // at the same path, so its last accepted cards no longer bind to the
  // control.
  const [sold, relabelled] = [4, 7];
  native.rows.set(sold, donors(sold, "M" + sold, 169));
  native.labels.set(relabelled, "MX");
  native.rows.set(relabelled, donors(relabelled, "MX"));
  const changed = await census(native, 602, next.terminal);
  expect(changed.models).toEqual(everyModel);
  expect(changed.requests).toBe(17);
  expect(changed.vins).toEqual(allVins(native));
  expect(changed.warnings.at(-1)).toBe(
    readSummary(
      everyModel.map((i) =>
        i === sold ? "count" : i === relabelled ? "new" : "daily",
      ),
    ),
  );
}, 30_000);

test("Central publishes a donor swapped in under an unchanged badge and drops the one it replaced", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // One donor is crushed and another placed under the same model, so its
  // badge and key stay the same.
  const swapped = 5;
  const [crushed, ...kept] = donors(swapped, "M" + swapped);
  if (crushed === undefined) throw new Error("Expected a donor to crush");
  const placed = centralFixtureRecord(swapped * 1000 + 171, "M" + swapped);
  native.rows.set(swapped, [...kept, placed]);
  const run = await census(native, 601, cold.terminal);
  expect(run.models).toEqual(everyModel);
  expect(run.requests).toBe(17);
  expect(run.warnings.at(-1)).toBe(readSummary(everyModel.map(() => "daily")));
  expect(run.vins).toContain(placed[0]);
  expect(run.vins).not.toContain(crushed[0]);
  expect(run.vins).toEqual(allVins(native));
  expect(
    terminalCensus(run.terminal).models.find(
      (m) => m.key === censusKey(swapped, "M" + swapped),
    )?.page.records,
  ).toEqual([...kept, placed]);
}, 30_000);

test("Central checkpoints charge a read for every model page of a daily run", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const day = 601;
  let cursor: CentralCursor = CentralCursor.initial;
  // One GET per chunk until the closing root has been read.
  for (
    let chunk = 0;
    chunk < 20 && !(cursor.phase === "closing" && cursor.closing === 1);
    chunk++
  ) {
    const result: CentralStreamResult = await Effect.runPromise(
      streamCentralInventoryWithRequestGate(
        {
          startCursor: cursor,
          previousCursor: cold.terminal,
          now: () => day * MODEL_CENSUS_DAY_MS,
          maxPages: 1,
          onBatch: () => Effect.void,
        },
        gate,
      ),
    );
    cursor = result.cursor;
  }
  if (cursor.phase !== "closing") throw new Error("Expected a closing cursor");
  expect(cursor.closing).toBe(1);
  // Root, makes, menu and all 12 models, then the closing root: nothing is
  // carried, so every page costs a GET.
  expect(cursor.requests).toBe(4 + 12);
  expect(cursor.pages).toHaveLength(12);
  const state = cursor;
  expect(() =>
    CentralCursor.checkpoint({ ...state, requests: state.requests + 1 }),
  ).toThrow("request accounting");
  // A model page that was not paid for is refused.
  expect(() =>
    CentralCursor.checkpoint({ ...state, requests: state.requests - 1 }),
  ).toThrow("request accounting");
}, 30_000);

test("Central reads every model on every run, even across missed runs", async () => {
  const native = yard();
  let previous = (await census(native, 600, null)).terminal;
  // Skip day 601 and 602 entirely, then run daily.
  for (const day of [603, 604, 605, 606, 607, 608, 609, 610, 611, 612]) {
    const run = await census(native, day, previous);
    expect(run.models).toEqual(everyModel);
    expect(run.requests).toBe(17);
    // The run after the gap reads in full as `gap`, every later one as
    // `daily`.
    expect(run.warnings.at(-1)).toBe(
      readSummary(everyModel.map(() => (day === 603 ? "gap" : "daily"))),
    );
    expect(run.vins).toEqual(allVins(native));
    expect(
      terminalCensus(run.terminal).models.every((m) => m.readDay === day),
    ).toBe(true);
    previous = run.terminal;
  }
}, 60_000);

test("Central confirms read models whose cards differ from their badge at closing, and skips the re-read while they repeat", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // A model now shows 171 on its badge but keeps 170 cards on every read.
  const badged = 6;
  native.badges.set(badged, 171);
  const steady = await census(native, 601, cold.terminal);
  // Every model, then the closing re-read of the badged model.
  expect(steady.models).toEqual([...everyModel, badged]);
  // root, makes, one menu, 12 models, closing root, makes and the badged
  // model.
  expect(steady.requests).toBe(18);
  expect(steady.vins).toEqual(allVins(native));
  expect(steady.warnings.at(-1)).toBe(
    readSummary(everyModel.map((i) => (i === badged ? "count" : "daily"))),
  );
  // Confirmed evidence is still read the next day. The page repeats it, so
  // closing does not re-read it.
  const next = await census(native, 602, steady.terminal);
  expect(next.models).toEqual(everyModel);
  expect(next.requests).toBe(17);
  expect(next.warnings.at(-1)).toBe(readSummary(everyModel.map(() => "daily")));

  // A short page that does not repeat at closing stops emission.
  const short = 2;
  native.once.set(short, donors(short, "M" + short, 120));
  await expect(census(native, 603, next.terminal)).rejects.toThrow(
    "model cards changed",
  );
}, 30_000);

/** The census a terminal cursor stores for the next run. */
function terminalCensus(terminal: unknown): CentralCensus {
  const cursor = CentralCursor.parse(JSON.stringify(terminal));
  if (cursor.phase !== "complete" || !cursor.census)
    throw new Error("Expected a terminal census");
  return cursor.census;
}

test("Central reads a confirmed short page daily and keeps it confirmed while it repeats", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // A model lists 150 of its 170 badged donors on every read.
  const short = 8;
  native.badges.set(short, 170);
  native.rows.set(short, donors(short, "M" + short, 150));
  const read = await census(native, 601, cold.terminal);
  // Every model, then the closing re-read of the short page.
  expect(read.models).toEqual([...everyModel, short]);
  const evidence = terminalCensus(read.terminal).models;
  expect(evidence.map((m) => m.confirmed)).toEqual(
    everyModel.map((i) => i === short),
  );
  // Confirmed in-run, so the next run reads it as `daily` rather than
  // `short`. It repeats its confirmed evidence, so closing skips its re-read
  // and it stays confirmed.
  const next = await census(native, 602, read.terminal);
  expect(next.models).toEqual(everyModel);
  expect(next.requests).toBe(17);
  expect(next.warnings.at(-1)).toBe(readSummary(everyModel.map(() => "daily")));
  expect(next.vins).toEqual(allVins(native));
  expect(
    terminalCensus(next.terminal).models.find(
      (m) => m.key === censusKey(short, "M" + short),
    ),
  ).toMatchObject({ readDay: 602, confirmed: true });
}, 30_000);

/** Two of twelve models (a sixth of the yard). */
const brokenModels = [1, 10];

test("Central fails a run whose model pages fall short of today's badges", async () => {
  // A site fault leaves a sixth of the model pages with one card each while
  // the menus keep their badges. The donor floor still passes, so badge
  // coverage must catch it.
  const native = yard(400);
  const cold = await census(native, 600, null);
  const day = 601;
  for (const model of brokenModels) native.broken.add(model);
  // The floor alone still passes: only coverage can stop this run.
  expect(
    400 * (12 - brokenModels.length) + brokenModels.length,
  ).toBeGreaterThan(1_985);
  let published = 0;
  let yards = 0;
  await expect(
    (async () => {
      let cursor: CentralCursor = CentralCursor.initial;
      while (cursor.phase !== "complete") {
        const result: CentralStreamResult = await Effect.runPromise(
          streamCentralInventoryWithRequestGate(
            {
              startCursor: cursor,
              previousCursor: cold.terminal,
              now: () => day * MODEL_CENSUS_DAY_MS,
              onYards: () =>
                Effect.sync(() => {
                  yards++;
                }),
              onBatch: (batch) =>
                Effect.sync(() => {
                  published += batch.length;
                }),
            },
            gate,
          ),
        );
        cursor = result.cursor;
      }
    })(),
  ).rejects.toThrow("promised by today's model counts, below the 95%");
  expect(published).toBe(0);
  expect(yards).toBe(0);
}, 30_000);

test("Central fails model pages cut to one card each even when their badges undercount", async () => {
  // A sixth of the models badge 10 cards but list 400 (surplus rows, as on 44
  // saved models). Cutting each to one card on a daily read keeps badge
  // coverage above 95%, so only replay of the last accepted cards can stop
  // this run.
  const native = yard(400);
  const day = 601;
  for (const model of brokenModels) native.badges.set(model, 10);
  const cold = await census(native, 600, null);
  for (const model of brokenModels) native.broken.add(model);
  const broken = brokenModels.length;
  const badges = 400 * (12 - broken) + 10 * broken;
  expect(badges - 9 * broken).toBeGreaterThanOrEqual(Math.ceil(badges * 0.95));
  expect(400 * (12 - broken) + broken).toBeGreaterThan(1_985);
  let published = 0;
  let yards = 0;
  await expect(
    (async () => {
      let cursor: CentralCursor = CentralCursor.initial;
      while (cursor.phase !== "complete") {
        const result: CentralStreamResult = await Effect.runPromise(
          streamCentralInventoryWithRequestGate(
            {
              startCursor: cursor,
              previousCursor: cold.terminal,
              now: () => day * MODEL_CENSUS_DAY_MS,
              onYards: () =>
                Effect.sync(() => {
                  yards++;
                }),
              onBatch: (batch) =>
                Effect.sync(() => {
                  published += batch.length;
                }),
            },
            gate,
          ),
        );
        cursor = result.cursor;
      }
    })(),
  ).rejects.toThrow(
    "that the last accepted census listed, less any drop in their counts, below the 97% coverage floor",
  );
  expect(published).toBe(0);
  expect(yards).toBe(0);
}, 30_000);

test("Central re-reads a surplus page that drops to its badge at closing", async () => {
  // A model badges 160 donors but lists 170 (surplus rows).
  const native = yard();
  const day = 601;
  const surplus = 9;
  native.badges.set(surplus, 160);
  const cold = await census(native, 600, null);
  const label = "M" + surplus;
  const kept = donors(surplus, label).slice(0, 160);
  // A surplus first seen on a cold read is unconfirmed until a normal
  // incremental run reads the page again.
  expect(
    terminalCensus(cold.terminal).models.find(
      (m) => m.key === censusKey(surplus, label),
    ),
  ).toMatchObject({
    readDay: 600,
    count: 160,
    expected: 170,
    lowSince: null,
    surplusConfirmed: false,
    confirmed: false,
  });

  // A transient drop to exactly its badge is re-read at closing, and the
  // complete closing read replaces it instead of passing as a healthy page.
  native.once.set(surplus, kept);
  const recovered = await census(native, day, cold.terminal);
  expect(recovered.models).toEqual([...everyModel, surplus]);
  expect(recovered.vins).toEqual(allVins(native));
  expect(
    terminalCensus(recovered.terminal).models.find(
      (m) => m.key === censusKey(surplus, label),
    )?.page.records,
  ).toEqual(donors(surplus, label));

  // A closing read that gains cards but only reaches its badge still stops
  // emission: only an exact repeat confirms a page at or below its badge.
  native.once.set(surplus, kept.slice(1));
  native.rows.set(surplus, kept);
  await expect(census(native, day, cold.terminal)).rejects.toThrow(
    "model cards changed",
  );

  // A drop that repeats at closing publishes, but is never confirmed, so the
  // next run reads the page again as short although its badge did not change.
  native.rows.set(surplus, kept);
  const dropped = await census(native, day, cold.terminal);
  expect(dropped.models).toEqual([...everyModel, surplus]);
  // root, makes, one menu, 12 models, the closing re-read of the surplus
  // page, closing root and makes.
  expect(dropped.requests).toBe(18);
  expect(dropped.vins).toEqual(allVins(native));
  // The unconfirmed cold surplus is read as short, every other page daily.
  expect(dropped.warnings.at(-1)).toBe(
    readSummary(everyModel.map((i) => (i === surplus ? "short" : "daily"))),
  );
  const evidence = terminalCensus(dropped.terminal).models.find(
    (m) => m.key === censusKey(surplus, label),
  );
  expect(evidence?.expected).toBe(170);
  expect(evidence?.lowSince).toBe(day);
  // A read listing less than the held surplus does not confirm it.
  expect(evidence?.surplusConfirmed).toBe(false);
  expect(evidence?.confirmed).toBe(false);
  expect(evidence?.page.records).toHaveLength(160);

  // The surplus is sticky: the lower count is not accepted after one re-read.
  // Every daily run reads the page again as short and re-reads it at closing,
  // until a normal incremental run reads it six days after the drop began.
  let previous = dropped.terminal;
  for (let today = day + 1; today <= day + MODEL_CENSUS_SWEEP_DAYS; today++) {
    const run = await census(native, today, previous);
    expect(run.models).toEqual([...everyModel, surplus]);
    expect(run.requests).toBe(18);
    expect(run.vins).toEqual(allVins(native));
    expect(run.warnings.at(-1)).toBe(
      readSummary(everyModel.map((i) => (i === surplus ? "short" : "daily"))),
    );
    const held = terminalCensus(run.terminal).models.find(
      (m) => m.key === censusKey(surplus, label),
    );
    const lowered = today - day >= MODEL_CENSUS_SWEEP_DAYS;
    expect(held?.readDay).toBe(today);
    expect(held?.count).toBe(160);
    expect(held?.expected).toBe(lowered ? 160 : 170);
    expect(held?.lowSince).toBe(lowered ? null : day);
    // Unconfirmed while the held surplus exceeds the reads; lowering to the
    // badge leaves no surplus, which is always confirmed.
    expect(held?.surplusConfirmed).toBe(lowered);
    expect(held?.confirmed).toBe(false);
    expect(held?.page.records).toHaveLength(160);
    previous = run.terminal;
  }

  // Once lowered, the page is no longer short and is read as daily. The
  // lowered surplus stays as a ceiling, but the page repeats the evidence the
  // last closing re-read confirmed, so closing does not re-read it again.
  const after = day + MODEL_CENSUS_SWEEP_DAYS + 1;
  const lowered = await census(native, after, previous);
  expect(lowered.models).toEqual(everyModel);
  expect(lowered.requests).toBe(17);
  expect(lowered.vins).toEqual(allVins(native));
  expect(lowered.warnings.at(-1)).toBe(
    readSummary(everyModel.map(() => "daily")),
  );
  expect(
    terminalCensus(lowered.terminal).models.find(
      (m) => m.key === censusKey(surplus, label),
    ),
  ).toMatchObject({
    readDay: after,
    count: 160,
    expected: 160,
    lowSince: null,
    ceiling: 10,
    surplusConfirmed: true,
    confirmed: false,
  });
}, 60_000);

/** A cold run on day 600 whose model M3 badges 160 donors but lists 170 at its
 * first read, so closing re-reads it; `closing` sets the cards that re-read
 * lists. */
function surplusClosing(closing: (first: CentralRecord[]) => CentralRecord[]) {
  const native = yard();
  const surplus = 3;
  const first = donors(surplus, "M" + surplus);
  native.badges.set(surplus, 160);
  native.once.set(surplus, first);
  native.rows.set(surplus, closing(first));
  return { native, surplus, run: () => census(native, 600, null) };
}

test("Central publishes donors that arrive on a surplus page before its closing re-read", async () => {
  const arrival = centralFixtureRecord(3171, "M3");
  const { native, surplus, run } = surplusClosing((first) => [
    ...first.map((record, index): CentralRecord => {
      const [vin, year, title, stock, destination] = record;
      // Optional metadata may change; the closing card wins.
      return index === 0
        ? [vin, year, title, "NEW" + stock, destination, "photo.jpg"]
        : record;
    }),
    arrival,
  ]);
  const closed = await run();
  // Every model, then the closing re-read of the surplus page.
  expect(closed.models).toEqual([...everyModel, surplus]);
  expect(closed.vins).toContain(arrival[0]);
  expect(closed.vins).toEqual(allVins(native));
  expect(
    terminalCensus(closed.terminal).models.find(
      (m) => m.key === censusKey(surplus, "M" + surplus),
    )?.page.records,
  ).toEqual(native.rows.get(surplus) ?? []);
}, 30_000);

/** A cold run stores a closing arrival as surplus: badge 160, 170 cards at
 * the first read and 171 at closing, so expected 171. On day 601 the badge
 * catches up to `badge` while the page lists the same 171 cards, below its
 * expected count, so the first read counts as short; `closing` sets the cards
 * its closing re-read lists. */
async function arrivalSurplus(
  badge: number,
  closing: (listed: CentralRecord[]) => CentralRecord[],
) {
  const { native, surplus, run } = surplusClosing((records) => [
    ...records,
    centralFixtureRecord(3171, "M3"),
  ]);
  const cold = await run();
  expect(
    terminalCensus(cold.terminal).models.find(
      (m) => m.key === censusKey(surplus, "M" + surplus),
    )?.expected,
  ).toBe(171);
  const listed = native.rows.get(surplus) ?? [];
  native.badges.set(surplus, badge);
  native.once.set(surplus, listed);
  native.rows.set(surplus, closing(listed));
  return { native, surplus, run: () => census(native, 601, cold.terminal) };
}

test("Central publishes an arrival on a page short of a surplus its badge caught up with", async () => {
  // The badge now counts one or two of the stored surplus cards, so the
  // first read is one or two cards short of its expected count.
  for (const badge of [161, 162]) {
    const arrival = centralFixtureRecord(3172, "M3");
    const { native, surplus, run } = await arrivalSurplus(badge, (listed) => [
      ...listed,
      arrival,
    ]);
    const closed = await run();
    // Every model (the surplus page as a count change), then the closing
    // re-read of the short page.
    expect(closed.models).toEqual([...everyModel, surplus]);
    expect(closed.requests).toBe(18);
    expect(closed.warnings.at(-1)).toBe(
      readSummary(everyModel.map((i) => (i === surplus ? "count" : "daily"))),
    );
    expect(closed.vins).toContain(arrival[0]);
    expect(closed.vins).toEqual(allVins(native));
    expect(
      terminalCensus(closed.terminal).models.find(
        (m) => m.key === censusKey(surplus, "M" + surplus),
      ),
    ).toMatchObject({
      count: badge,
      confirmed: false,
      page: { records: native.rows.get(surplus) ?? [] },
    });
  }
}, 30_000);

test("Central fails a closing re-read that gains cards but stays at or below its badge", async () => {
  for (const closing of [160, 170]) {
    const native = yard();
    const short = 3;
    const listed = donors(short, "M" + short);
    native.once.set(short, listed.slice(0, 150));
    native.rows.set(short, listed.slice(0, closing));
    const drift: unknown = await census(native, 600, null).catch(
      (error: unknown) => error,
    );
    expect(() => {
      throw drift;
    }).toThrow("Closing Central model cards changed");
    // The yard changed while it was read, so a crawl later today can pass.
    expect(validationRejectionKind(drift)).toBe("transient");
  }
}, 30_000);

test("Central fails a closing re-read that drops a donor even when another arrives", async () => {
  const { run } = surplusClosing((first) => [
    ...first.slice(1),
    centralFixtureRecord(3171, "M3"),
  ]);
  await expect(run()).rejects.toThrow(
    "Closing Central model cards lost VIN 1HGCM82633A003001",
  );
}, 30_000);

test("Central fails a closing re-read that changes a donor's year, title or destination", async () => {
  for (const field of [1, 2, 4] as const) {
    const { run } = surplusClosing((first) =>
      first.map((record, index): CentralRecord => {
        if (index !== 0) return record;
        const changed: CentralRecord = [...record];
        changed[field] =
          field === 4 ? "/used-parts/ACURA/M3/OTHER/2003" : "2004";
        return changed;
      }),
    );
    await expect(run()).rejects.toThrow(
      "Closing Central model card for VIN 1HGCM82633A003001 changed",
    );
  }
}, 30_000);

const otherMake: CentralControl = {
  path: "/used-parts/BMW",
  label: "BMW",
  count: 1,
};
const otherModel: CentralControl = {
  path: "/used-parts/BMW/X5",
  label: "X5",
  count: 1,
};
type MakeDirectory = (make: CentralControl) => CentralControl[];

/** Serves `first` as the opening make directory and `closing` as every later
 * one, each given the yard's make with its live badge. `otherMake` lists one
 * single-card model. */
function makeDirectories(
  native: ReturnType<typeof yard>,
  first: MakeDirectory,
  closing: MakeDirectory,
) {
  const serve = globalThis.fetch;
  let directories = 0;
  const html = (body: string) =>
    new Response(body, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url === CENTRAL_ORIGIN + otherMake.path)
        return html(centralFixtureDirectory([otherModel], "models"));
      if (url === CENTRAL_ORIGIN + otherModel.path)
        return html(
          centralFixtureModelPage(
            [
              [
                "WBAFB33521LH00001",
                "2001",
                "BMW X5",
                "ST1",
                "/used-parts/BMW/X5/ST1/2001",
                null,
              ],
            ],
            otherMake,
            otherModel,
          ),
        );
      if (url !== CENTRAL_MAKES) return serve(input);
      const total = [...native.rows.values()].reduce((n, l) => n + l.length, 0);
      const make = { ...centralFixtureMake, count: total };
      return html(
        centralFixtureDirectory(
          ++directories === 1 ? first(make) : closing(make),
          "makes",
        ),
      );
    },
    { preconnect: originalFetch.preconnect },
  );
}

test("Central accepts a closing make directory whose badges drifted", async () => {
  // Central serves /used-parts/ from several stale cache versions and adds
  // donors all day, so make badges differ between reads of one run.
  for (const delta of [-1, 1]) {
    const native = yard();
    makeDirectories(
      native,
      (make) => [make],
      (make) => [{ ...make, count: make.count + delta }],
    );
    const run = await census(native, 600, null);
    expect(run.vins).toEqual(allVins(native));
  }
}, 30_000);

test("Central fails a closing make directory that adds, drops, relabels or reorders a make", async () => {
  const changes: [MakeDirectory, MakeDirectory][] = [
    [(make) => [make], (make) => [make, otherMake]],
    [(make) => [make, otherMake], (make) => [make]],
    [(make) => [make], (make) => [{ ...make, label: "ACURA CARS" }]],
    [(make) => [make, otherMake], (make) => [otherMake, make]],
  ];
  for (const [first, closing] of changes) {
    const native = yard();
    makeDirectories(native, first, closing);
    await expect(census(native, 600, null)).rejects.toThrow(
      "Closing Central make graph changed",
    );
  }
}, 30_000);

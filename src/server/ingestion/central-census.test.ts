import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  streamCentralInventoryWithRequestGate,
  type CentralStreamResult,
} from "./central-connector";
import { CentralCursor, type CentralCensus } from "./central-cursor";
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

/** Models, in list order, whose sweep slice falls on `day`. */
const sweep = (native: ReturnType<typeof yard>, day: number) =>
  [...native.rows.keys()].filter(
    (i) =>
      ModelCensus.slice(censusKey(i, native.labels.get(i) ?? "")) ===
      day % MODEL_CENSUS_SWEEP_DAYS,
  );

/** The first day after `after` whose sweep slice holds a model. */
function nextSweepDay(native: ReturnType<typeof yard>, after: number) {
  for (let day = after + 1; day <= after + MODEL_CENSUS_SWEEP_DAYS; day++)
    if (sweep(native, day).length > 0) return day;
  throw new Error("Expected a non-empty sweep slice within six days");
}

/** Models in list order that are in `included` or are `extra`. */
const inListOrder = (
  native: ReturnType<typeof yard>,
  included: readonly number[],
  ...extra: number[]
) =>
  [...native.rows.keys()].filter(
    (i) => included.includes(i) || extra.includes(i),
  );

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
  // Only the sweep slice (slice(key) === day % 6) is read.
  const nextDay = nextSweepDay(native, 600);
  const swept = sweep(native, nextDay);
  const next = await census(native, nextDay, cold.terminal);
  expect(next.models).toEqual(swept);
  // root, makes, one menu, the swept models, closing root and makes.
  expect(next.requests).toBe(5 + swept.length);
  // Carried donors are still published in full.
  expect(next.vins).toEqual(allVins(native));

  // A sold donor changes one unswept model's count, and another unswept model
  // is relabelled at the same path, so its carried cards no longer bind to
  // the control.
  const changedDay = nextSweepDay(native, nextDay);
  const due = sweep(native, changedDay);
  const [sold, relabelled] = [...native.rows.keys()].filter(
    (i) => !due.includes(i),
  );
  if (sold === undefined || relabelled === undefined)
    throw new Error("Expected two models outside the sweep slice");
  native.rows.set(sold, donors(sold, "M" + sold, 169));
  native.labels.set(relabelled, "MX");
  native.rows.set(relabelled, donors(relabelled, "MX"));
  const changed = await census(native, changedDay, next.terminal);
  const expected = inListOrder(native, due, sold, relabelled);
  expect(changed.models).toEqual(expected);
  expect(changed.vins).toEqual(allVins(native));
  const reasons = new Map<string, number>();
  for (const i of expected) {
    const reason = i === sold ? "count" : i === relabelled ? "new" : "sweep";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  expect(changed.warnings.at(-1)).toBe(
    `Central Read ${expected.length} of 12 model pages (${[...reasons]
      .map(([reason, n]) => `${reason} ${n}`)
      .join(", ")}); carried ${12 - expected.length}.`,
  );
  expect(reasons.get("sweep")).toBe(due.length);
});

test("Central checkpoints refuse edited carried pages and unpaid carried reads", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const day = nextSweepDay(native, 600);
  const swept = sweep(native, day);
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
  // Root, makes, menu and the swept models, then the closing root.
  expect(cursor.requests).toBe(4 + swept.length);
  expect(cursor.pages).toHaveLength(12);
  const state = cursor;
  const carriedIndex = [...native.rows.keys()].findIndex(
    (i) => !swept.includes(i),
  );
  const page = state.pages[carriedIndex];
  if (!page) throw new Error("Expected a carried page");
  const records = page.records.slice(1);
  const edited = { records, hash: centralHash(records) };
  expect(() =>
    CentralCursor.checkpoint({
      ...state,
      pages: state.pages.map((p, i) => (i === carriedIndex ? edited : p)),
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
  let steadyReads = 0;
  // Skip day 601 and 602 entirely, then run daily.
  for (const day of [603, 604, 605, 606, 607, 608, 609, 610, 611, 612]) {
    const run = await census(native, day, previous);
    for (const model of run.models) lastRead.set(model, day);
    for (const read of lastRead.values()) expect(day - read).toBeLessThan(6);
    // Once the missed-run backlog is cleared, exactly that day's sweep slice.
    if (day >= 607) {
      expect(run.models).toEqual(sweep(native, day));
      steadyReads += run.models.length;
    }
    expect(run.vins).toEqual(allVins(native));
    previous = run.terminal;
  }
  // Six steady days read every model exactly once.
  expect(steadyReads).toBe(12);
}, 60_000);

test("Central confirms read models whose cards differ from their badge before carrying them", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const steadyDay = nextSweepDay(native, 600);
  const carriedDay = nextSweepDay(native, steadyDay);
  // A model outside both sweep slices now shows 171 on its badge but keeps
  // 170 cards on every read.
  const badged = [...native.rows.keys()].find(
    (i) =>
      !sweep(native, steadyDay).includes(i) &&
      !sweep(native, carriedDay).includes(i),
  );
  if (badged === undefined) throw new Error("Expected an unswept model");
  native.badges.set(badged, 171);
  const steady = await census(native, steadyDay, cold.terminal);
  // The sweep slice plus the count change, then its closing re-read.
  const read = inListOrder(native, sweep(native, steadyDay), badged);
  expect(steady.models).toEqual([...read, badged]);
  // root, makes, one menu, the read models, closing root, makes and the
  // badged model.
  expect(steady.requests).toBe(6 + read.length);
  expect(steady.vins).toEqual(allVins(native));
  // Carried short evidence is not re-read at closing.
  const carried = await census(native, carriedDay, steady.terminal);
  expect(carried.models).toEqual(sweep(native, carriedDay));

  // A short page on a model's sweep day that does not repeat stops emission
  // instead of being carried for six days.
  const shortDay = nextSweepDay(native, carriedDay);
  const short = sweep(native, shortDay).find((i) => i !== badged);
  if (short === undefined) throw new Error("Expected a swept model");
  native.once.set(short, donors(short, "M" + short, 120));
  await expect(census(native, shortDay, carried.terminal)).rejects.toThrow(
    "model cards changed",
  );
});

/** The census a terminal cursor stores for the next run. */
function terminalCensus(terminal: unknown): CentralCensus {
  const cursor = CentralCursor.parse(JSON.stringify(terminal));
  if (cursor.phase !== "complete" || !cursor.census)
    throw new Error("Expected a terminal census");
  return cursor.census;
}

test("Central carries a short page closing confirmed without reading it again", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const readDay = nextSweepDay(native, 600);
  const carriedDay = nextSweepDay(native, readDay);
  // A swept model lists 150 of its 170 badged donors on every read.
  const short = sweep(native, readDay).find(
    (i) => !sweep(native, carriedDay).includes(i),
  );
  if (short === undefined)
    throw new Error("Expected a model swept on the read day only");
  native.badges.set(short, 170);
  native.rows.set(short, donors(short, "M" + short, 150));
  const read = await census(native, readDay, cold.terminal);
  // The sweep slice, then the closing re-read of the short page.
  expect(read.models).toEqual([...sweep(native, readDay), short]);
  const evidence = terminalCensus(read.terminal).models;
  expect(evidence.map((m) => m.confirmed)).toEqual(
    [...native.rows.keys()].map((i) => i === short),
  );
  // Confirmed in-run, so the next run carries it instead of a "short" read.
  const carried = await census(native, carriedDay, read.terminal);
  expect(carried.models).toEqual(sweep(native, carriedDay));
  expect(carried.warnings.at(-1)).not.toContain("short");
  expect(
    terminalCensus(carried.terminal).models.find(
      (m) => m.key === censusKey(short, "M" + short),
    )?.confirmed,
  ).toBe(true);
});

test("Central fails a run whose read and carried cards fall short of today's badges", async () => {
  // A site fault leaves every model page with one card while the menus keep
  // their badges. A full daily read would trip the floor; with carried pages
  // only today's sweep slice breaks, so badge coverage must catch it.
  const native = yard(400);
  const cold = await census(native, 600, null);
  const day = nextSweepDay(native, 600);
  const swept = sweep(native, day);
  for (const model of swept) native.broken.add(model);
  // The floor alone still passes: only coverage can stop this run.
  expect(400 * (12 - swept.length) + swept.length).toBeGreaterThan(1_985);
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
  ).rejects.toThrow("coverage floor");
  expect(published).toBe(0);
  expect(yards).toBe(0);
});

test("Central fails a sweep slice cut to one card per model even when its badges undercount", async () => {
  // Today's swept models badge 10 cards but list 400 (surplus rows, as on 44
  // saved models). Cutting each to one card keeps badge coverage above 95%,
  // so only replay of the last accepted cards can stop this run.
  const native = yard(400);
  const day = nextSweepDay(native, 600);
  const swept = sweep(native, day);
  for (const model of swept) native.badges.set(model, 10);
  const cold = await census(native, 600, null);
  for (const model of swept) native.broken.add(model);
  const badges = 400 * (12 - swept.length) + 10 * swept.length;
  expect(badges - 9 * swept.length).toBeGreaterThanOrEqual(
    Math.ceil(badges * 0.95),
  );
  expect(400 * (12 - swept.length) + swept.length).toBeGreaterThan(1_985);
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
});

test("Central re-reads a surplus page that drops to its badge instead of carrying it", async () => {
  // A swept model badges 160 donors but lists 170 (surplus rows).
  const native = yard();
  const day = nextSweepDay(native, 600);
  const surplus = sweep(native, day)[0];
  if (surplus === undefined) throw new Error("Expected a swept model");
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

  // A transient drop to exactly its badge is re-read at closing and stops
  // emission instead of passing as a healthy page for six days.
  native.once.set(surplus, kept);
  let published = 0;
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
  ).rejects.toThrow("model cards changed");
  expect(published).toBe(0);

  // A drop that repeats at closing publishes, but is never confirmed, so the
  // next run reads the page again although its badge did not change.
  native.rows.set(surplus, kept);
  const dropped = await census(native, day, cold.terminal);
  expect(dropped.models).toEqual([...sweep(native, day), surplus]);
  // root, makes, one menu, the swept models, the closing re-read of the
  // surplus page, closing root and makes.
  expect(dropped.requests).toBe(5 + sweep(native, day).length + 1);
  expect(dropped.vins).toEqual(allVins(native));
  // The unconfirmed cold surplus is read as short, ahead of its sweep slice.
  const swept = sweep(native, day).length - 1;
  expect(dropped.warnings.at(-1)).toBe(
    `Central Read ${swept + 1} of 12 model pages (short 1${
      swept > 0 ? `, sweep ${swept}` : ""
    }); carried ${11 - swept}.`,
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
  const lastRead = new Map([...native.rows.keys()].map((i) => [i, 600]));
  for (const i of [...sweep(native, day), surplus]) lastRead.set(i, day);
  let previous = dropped.terminal;
  for (let today = day + 1; today <= day + MODEL_CENSUS_SWEEP_DAYS; today++) {
    const run = await census(native, today, previous);
    const read = inListOrder(native, sweep(native, today), surplus);
    expect(run.models).toEqual([...read, surplus]);
    // root, makes, one menu, the read models, the closing re-read of the
    // surplus page, closing root and makes.
    expect(run.requests).toBe(5 + read.length + 1);
    expect(run.vins).toEqual(allVins(native));
    const reasons = new Map<string, number>();
    for (const i of read) {
      const reason =
        i === surplus
          ? "short"
          : today - (lastRead.get(i) ?? 600) >= MODEL_CENSUS_SWEEP_DAYS
            ? "stale"
            : "sweep";
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      lastRead.set(i, today);
    }
    expect(reasons.get("short")).toBe(1);
    expect(run.warnings.at(-1)).toBe(
      `Central Read ${read.length} of 12 model pages (${[...reasons]
        .map(([reason, n]) => `${reason} ${n}`)
        .join(", ")}); carried ${12 - read.length}.`,
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

  // Once lowered, the page lists its expected count and carries.
  const after = day + MODEL_CENSUS_SWEEP_DAYS + 1;
  const carried = await census(native, after, previous);
  expect(carried.models).toEqual(sweep(native, after));
  expect(carried.models).not.toContain(surplus);
  expect(carried.requests).toBe(5 + sweep(native, after).length);
  expect(carried.vins).toEqual(allVins(native));
  expect(carried.warnings.at(-1)).not.toContain("short");
  expect(
    terminalCensus(carried.terminal).models.find(
      (m) => m.key === censusKey(surplus, label),
    ),
  ).toMatchObject({
    readDay: day + MODEL_CENSUS_SWEEP_DAYS,
    count: 160,
    expected: 160,
    lowSince: null,
    surplusConfirmed: true,
    confirmed: false,
  });
});

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
  expect(closed.models).toEqual([
    ...Array.from({ length: 12 }, (_, i) => i),
    surplus,
  ]);
  expect(closed.vins).toContain(arrival[0]);
  expect(closed.vins).toEqual(allVins(native));
  expect(
    terminalCensus(closed.terminal).models.find(
      (m) => m.key === censusKey(surplus, "M" + surplus),
    )?.page.records,
  ).toEqual(native.rows.get(surplus) ?? []);
});

test("Central fails a closing re-read that drops a donor even when another arrives", async () => {
  const { run } = surplusClosing((first) => [
    ...first.slice(1),
    centralFixtureRecord(3171, "M3"),
  ]);
  await expect(run()).rejects.toThrow(
    "Closing Central model cards lost VIN 1HGCM82633A003001",
  );
});

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
});

test("Central fails a closing make directory whose badges or destinations changed", async () => {
  for (const change of [
    (make: CentralControl) => [{ ...make, count: make.count - 1 }],
    (make: CentralControl) => [{ ...make, count: make.count + 1 }],
    (make: CentralControl) => [
      make,
      { path: "/used-parts/BMW", label: "BMW", count: 1 },
    ],
  ]) {
    const native = yard();
    const serve = globalThis.fetch;
    let directories = 0;
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url !== CENTRAL_MAKES || ++directories === 1) return serve(input);
        const total = [...native.rows.values()].reduce(
          (n, l) => n + l.length,
          0,
        );
        return new Response(
          centralFixtureDirectory(
            change({ ...centralFixtureMake, count: total }),
            "makes",
          ),
          { status: 200, headers: { "content-type": "text/html" } },
        );
      },
      { preconnect: originalFetch.preconnect },
    );
    await expect(census(native, 600, null)).rejects.toThrow(
      "Closing Central make graph changed",
    );
  }
});

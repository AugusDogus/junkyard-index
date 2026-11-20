import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  streamAplusInventoryWithRequestGate,
  type AplusStreamResult,
} from "./aplus-connector";
import { AplusCursor, AplusCursorSchema } from "./aplus-cursor";
import type { AplusControl, AplusRecord } from "./aplus-parser";
import {
  APLUS_CONTACT,
  APLUS_MAKES,
  APLUS_ORIGIN,
  APLUS_ROOT,
} from "./aplus-yard-metadata";
import {
  aplusFixtureContact,
  aplusFixtureDirectory,
  aplusFixtureModelPage,
  aplusFixtureRoot,
} from "./aplus-test-fixtures";
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
const make: AplusControl = { path: "/parts/ACURA", label: "ACURA", count: 0 };
const label = (i: number) => "M" + i;
const record = (model: number, n: number): AplusRecord => [
  "1HGCM82633A" + String(model * 1000 + n).padStart(6, "0"),
  "2003",
  "ACURA " + label(model),
  "ST" + model + "-" + n,
  `/parts/ACURA/${label(model)}/ST${model}-${n}/2003`,
  null,
  null,
];

const donors = (model: number, n = 40) =>
  Array.from({ length: n }, (_, i) => record(model, i + 1));

/** Twelve models with 40 donors each (above the 407 floor); `rows` can be
 * edited between runs. */
function yard() {
  const rows = new Map(Array.from({ length: 12 }, (_, i) => [i, donors(i)]));
  // Arrivals always list at least one card; this donor is already on M0.
  let arrivals: AplusRecord[] = [record(0, 1)];
  // Models whose page renders the native empty result while the menus still
  // count their donors.
  const broken = new Set<number>();
  const urls: string[] = [];
  const models = () =>
    [...rows].map(
      ([i, list]): AplusControl => ({
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
        url === APLUS_CONTACT
          ? aplusFixtureContact
          : url === APLUS_ROOT
            ? aplusFixtureRoot(arrivals)
            : url === APLUS_MAKES
              ? aplusFixtureDirectory([{ ...make, count: total }], "makes")
              : url === APLUS_ORIGIN + make.path
                ? aplusFixtureDirectory(models(), "models")
                : model
                  ? aplusFixtureModelPage(
                      broken.has(Number(model[1]))
                        ? []
                        : (rows.get(Number(model[1])) ?? []),
                      `Used ACURA ${label(Number(model[1]))} Parts`,
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
    broken,
    urls,
    setArrivals: (next: AplusRecord[]) => {
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
  let cursor: AplusCursor = AplusCursor.initial;
  const vins: string[] = [];
  const warnings: string[] = [];
  let chunk = 0;
  while (cursor.phase !== "complete") {
    // Only the first chunk may fix the run day and adopt a census. Later
    // chunks see a junk previous cursor and a clock past midnight; re-applying
    // either would change the plan and fail checkpoint validation.
    const first = chunk++ === 0;
    const result = await Effect.runPromise(
      streamAplusInventoryWithRequestGate(
        {
          startCursor: cursor,
          previousCursor: first ? previousCursor : { source: "aplus" },
          now: () =>
            (first ? day : day + 1) * MODEL_CENSUS_DAY_MS + 7 * 60 * 60 * 1000,
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
    cursor = AplusCursor.parse(AplusCursor.serialize(result.cursor));
  }
  const models = native.urls
    .slice(before)
    .flatMap((url) => /\/parts\/ACURA\/M(\d+)\/$/.exec(url)?.[1] ?? [])
    .map(Number);
  return {
    terminal: JSON.parse(AplusCursor.serialize(cursor)) as unknown,
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

test("A Plus cold start reads every model and publishes its census", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  expect(cold.models).toEqual(Array.from({ length: 12 }, (_, i) => i));
  // contact, arrivals, makes, one menu, 12 models, closing contact and makes.
  expect(cold.requests).toBe(18);
  expect(cold.vins).toEqual(allVins(native));
  expect(cold.warnings.at(-1)).toBe(
    "Aplus Read 12 of 12 model pages (cold 12); carried 0.",
  );
  // An unreadable previous checkpoint is a warned cold census, not a failure.
  const fallback = await census(native, 601, { source: "aplus", junk: true });
  expect(fallback.models).toHaveLength(12);
  expect(fallback.warnings[0]).toContain("reading every model page");
});

test("A Plus starts a warned cold census when a carried page fails its fingerprint", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const terminal = AplusCursorSchema.parse(cold.terminal);
  if (terminal.phase !== "complete" || !terminal.census)
    throw new Error("Expected a terminal census");
  const [first, ...rest] = terminal.census.models;
  if (!first) throw new Error("Expected census evidence");
  const tampered = {
    ...terminal,
    census: {
      ...terminal.census,
      models: [{ ...first, page: { ...first.page, records: [] } }, ...rest],
    },
  };
  const next = await census(native, 601, tampered);
  expect(next.models).toHaveLength(12);
  expect(next.warnings[0]).toContain("record fingerprint");
  expect(next.vins).toEqual(allVins(native));
});

/** Models in a day's sweep slice, keyed exactly as A Plus binds them. */
const swept = (day: number) =>
  Array.from({ length: 12 }, (_, i) => i).filter(
    (i) =>
      ModelCensus.slice(
        JSON.stringify([
          make.path,
          make.label,
          `/parts/ACURA/${label(i)}/`,
          label(i),
        ]),
      ) ===
      day % MODEL_CENSUS_SWEEP_DAYS,
  );

test("A Plus carries unread models, rotates the sweep and reads changes", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // Day 601: only that day's sweep slice is read.
  const next = await census(native, 601, cold.terminal);
  expect(next.models).toEqual(swept(601));
  expect(next.models.length).toBeLessThan(12);
  expect(next.requests).toBe(6 + swept(601).length);
  // Carried donors are still published in full.
  expect(next.vins).toEqual(allVins(native));

  // Day 602: a sold donor changes one model's count; on another a donor is
  // swapped for an arrival at the same count, which only the arrival reveals.
  const [sold, swapped] = Array.from({ length: 12 }, (_, i) => i).filter(
    (i) => !swept(602).includes(i),
  );
  if (sold === undefined || swapped === undefined)
    throw new Error("fixture needs two models outside the day 602 slice");
  native.rows.set(sold, donors(sold, 39));
  const arrival = record(swapped, 41);
  native.rows.set(swapped, [...donors(swapped).slice(1), arrival]);
  native.setArrivals([arrival]);
  const changed = await census(native, 602, next.terminal);
  expect(changed.models).toEqual(
    [...swept(602), sold, swapped].sort((x, y) => x - y),
  );
  expect(changed.vins).toEqual(allVins(native));
  const sweeps = swept(602).length;
  // Reasons are listed in published model order.
  const reasons = new Map<string, number>();
  for (const model of changed.models) {
    const reason = swept(602).includes(model)
      ? "sweep"
      : model === sold
        ? "count"
        : "trigger";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const listed = [...reasons].map(([reason, n]) => `${reason} ${n}`);
  expect(changed.warnings.at(-1)).toBe(
    `Aplus Read ${sweeps + 2} of 12 model pages (${listed.join(", ")}); carried ${10 - sweeps}.`,
  );
});

test("A Plus re-reads every model within six days, even across missed runs", async () => {
  const native = yard();
  let previous = (await census(native, 600, null)).terminal;
  const lastRead = new Map<number, number>();
  for (let i = 0; i < 12; i++) lastRead.set(i, 600);
  // Skip day 601 and 602 entirely, then run daily.
  for (const day of [603, 604, 605, 606, 607, 608, 609, 610, 611, 612]) {
    const run = await census(native, day, previous);
    for (const model of run.models) lastRead.set(model, day);
    for (const read of lastRead.values()) expect(day - read).toBeLessThan(6);
    expect(run.vins).toEqual(allVins(native));
    previous = run.terminal;
  }
});

test("A Plus fails a run whose read and carried cards fall short of today's model counts", async () => {
  // A site fault renders empty model pages while the menus look normal. Under
  // a full daily read the floor caught it; with carried pages only today's
  // sweep slice breaks, so the badge coverage check must catch it.
  const native = yard();
  const cold = await census(native, 600, null);
  const day = [601, 602, 603, 604, 605].find((d) => swept(d).length > 0);
  if (day === undefined) throw new Error("fixture needs a non-empty slice");
  for (const model of swept(day)) native.broken.add(model);
  let published = 0;
  await expect(
    (async () => {
      let cursor: AplusCursor = AplusCursor.initial;
      while (cursor.phase !== "complete") {
        const result: AplusStreamResult = await Effect.runPromise(
          streamAplusInventoryWithRequestGate(
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
  ).rejects.toThrow("coverage floor");
  expect(published).toBe(0);
});

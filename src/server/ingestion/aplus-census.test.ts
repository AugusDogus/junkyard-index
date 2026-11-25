import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamAplusInventoryWithRequestGate } from "./aplus-connector";
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
import { MODEL_CENSUS_DAY_MS } from "./model-census";

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

/** `models` models with 40 donors each (12 by default, above the 407 floor);
 * `rows` can be edited between runs. */
function yard(models = 12) {
  const rows = new Map(
    Array.from({ length: models }, (_, i) => [i, donors(i)]),
  );
  // Arrivals always list at least one card; this donor is already on M0.
  let arrivals: AplusRecord[] = [record(0, 1)];
  // Models whose page renders the native empty result while the menus still
  // count their donors.
  const broken = new Set<number>();
  // Models whose page lists only its first card while the menus still count
  // every donor.
  const cut = new Set<number>();
  // Models whose menu badge differs from the cards their page lists.
  const badges = new Map<number, number>();
  // Models whose every second read (while flaky) lists one card less, so a
  // closing re-read disagrees with the page read earlier in the run.
  const flaky = new Map<number, number>();
  const urls: string[] = [];
  const controls = () =>
    [...rows].map(
      ([i, list]): AplusControl => ({
        path: `/parts/ACURA/${label(i)}/`,
        label: label(i),
        count: badges.get(i) ?? list.length,
      }),
    );
  const listed = (model: number) => {
    const list = rows.get(model) ?? [];
    if (broken.has(model)) return [];
    if (cut.has(model)) return list.slice(0, 1);
    const reads = flaky.get(model);
    if (reads === undefined) return list;
    flaky.set(model, reads + 1);
    return reads % 2 === 1 ? list.slice(1) : list;
  };
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      urls.push(url);
      const total = controls().reduce((n, c) => n + c.count, 0);
      const model = /\/parts\/ACURA\/M(\d+)\/$/.exec(url);
      const body =
        url === APLUS_CONTACT
          ? aplusFixtureContact
          : url === APLUS_ROOT
            ? aplusFixtureRoot(arrivals)
            : url === APLUS_MAKES
              ? aplusFixtureDirectory([{ ...make, count: total }], "makes")
              : url === APLUS_ORIGIN + make.path
                ? aplusFixtureDirectory(controls(), "models")
                : model
                  ? aplusFixtureModelPage(
                      listed(Number(model[1])),
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
    cut,
    badges,
    flaky,
    urls,
    setArrivals: (next: AplusRecord[]) => {
      arrivals = next;
    },
  };
}

/** One full run on `day`, seeded by the previous terminal cursor. Published
 * VINs are also pushed to `published`, so a rejected run can show it emitted
 * nothing. */
async function census(
  native: ReturnType<typeof yard>,
  day: number,
  previousCursor: unknown,
  published: string[] = [],
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
              published.push(...batch.map((v) => v.vin));
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
const every = (n: number) => Array.from({ length: n }, (_, i) => i);
// Contact, arrivals, makes, one menu, 12 models, closing contact and makes.
const FULL_READ_REQUESTS = 18;
const BADGE_FLOOR = "promised by today's model counts, below the 95%";
const REPLAY_FLOOR =
  "that the last accepted census listed, less any drop in their counts, below the 97%";

test("A Plus cold start reads every model and publishes its census", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  expect(cold.models).toEqual(every(12));
  expect(cold.requests).toBe(FULL_READ_REQUESTS);
  expect(cold.vins).toEqual(allVins(native));
  expect(cold.warnings.at(-1)).toBe(
    "Aplus Read 12 of 12 model pages (cold 12); carried 0.",
  );
  // An unreadable previous checkpoint is a warned cold census, not a failure.
  const fallback = await census(native, 601, { source: "aplus", junk: true });
  expect(fallback.models).toHaveLength(12);
  expect(fallback.warnings[0]).toContain("reading every model page");
});

test("A Plus starts a warned cold census when a previous census page fails its fingerprint", async () => {
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

test("A Plus reads every model page daily and publishes a donor replaced under an unchanged badge", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // Day 601: nothing changed, and every model page is still read.
  const next = await census(native, 601, cold.terminal);
  expect(next.models).toEqual(every(12));
  expect(next.requests).toBe(FULL_READ_REQUESTS);
  expect(next.vins).toEqual(allVins(native));
  expect(next.warnings.at(-1)).toBe(
    "Aplus Read 12 of 12 model pages (daily 12); carried 0.",
  );

  // Day 602: a sold donor changes M3's badge. On M5 one donor is crushed and
  // another placed at the same badge, with no arrival naming it, so only the
  // daily read can see it. On M7 the same swap is named by an arrival.
  native.rows.set(3, donors(3, 39));
  const crushed = record(5, 1);
  const placed = record(5, 41);
  native.rows.set(5, [...donors(5).slice(1), placed]);
  const arrival = record(7, 41);
  native.rows.set(7, [...donors(7).slice(1), arrival]);
  native.setArrivals([arrival]);
  const changed = await census(native, 602, next.terminal);
  expect(changed.models).toEqual(every(12));
  expect(changed.requests).toBe(FULL_READ_REQUESTS);
  expect(changed.vins).toEqual(allVins(native));
  expect(changed.vins).toContain(placed[0]);
  expect(changed.vins).not.toContain(crushed[0]);
  expect(changed.vins).not.toContain(record(3, 40)[0]);
  expect(changed.vins).not.toContain(record(7, 1)[0]);
  // Reasons are listed in published model order.
  expect(changed.warnings.at(-1)).toBe(
    "Aplus Read 12 of 12 model pages (daily 10, count 1, trigger 1); carried 0.",
  );
});

test("A Plus reads every model page on every run, even across missed runs", async () => {
  const native = yard();
  let previous = (await census(native, 600, null)).terminal;
  // Skip day 601 and 602 entirely, then run daily.
  for (const [day, reason] of [
    [603, "gap"],
    [604, "daily"],
    [605, "daily"],
  ] as const) {
    const run = await census(native, day, previous);
    expect(run.models).toEqual(every(12));
    expect(run.requests).toBe(FULL_READ_REQUESTS);
    expect(run.vins).toEqual(allVins(native));
    expect(run.warnings.at(-1)).toBe(
      `Aplus Read 12 of 12 model pages (${reason} 12); carried 0.`,
    );
    previous = run.terminal;
  }
});

test("A Plus re-reads a confirmed short page at closing only when it changes, and fails when the re-read differs", async () => {
  const native = yard();
  // M9's badge promises one more donor than its page lists.
  native.badges.set(9, 41);
  const cold = await census(native, 600, null);
  // A full read plus M9's closing re-read.
  expect(cold.requests).toBe(FULL_READ_REQUESTS + 1);
  expect(cold.models.filter((m) => m === 9)).toHaveLength(2);
  // A cold run confirms no short page, so the next run reads M9 as short.
  const confirming = await census(native, 601, cold.terminal);
  expect(confirming.requests).toBe(FULL_READ_REQUESTS + 1);
  expect(confirming.vins).toEqual(allVins(native));
  expect(confirming.warnings.at(-1)).toBe(
    "Aplus Read 12 of 12 model pages (daily 11, short 1); carried 0.",
  );
  // Once confirmed, M9 is still read daily. While it repeats its confirmed
  // evidence, closing does not re-read it.
  const confirmed = await census(native, 602, confirming.terminal);
  expect(confirmed.requests).toBe(FULL_READ_REQUESTS);
  expect(confirmed.models.filter((m) => m === 9)).toHaveLength(1);
  expect(confirmed.vins).toEqual(allVins(native));
  expect(confirmed.warnings.at(-1)).toBe(
    "Aplus Read 12 of 12 model pages (daily 12); carried 0.",
  );
  // A daily read that lists other cards is re-read at closing, and a re-read
  // that disagrees with it stops the run before emission.
  native.flaky.set(9, 1);
  const published: string[] = [];
  await expect(
    census(native, 603, confirmed.terminal, published),
  ).rejects.toThrow("Closing Aplus model list M9");
  expect(published).toHaveLength(0);
});

test("A Plus fails a run whose read cards fall short of today's model counts", async () => {
  // A site fault renders a sixth of the model pages empty, or cuts them to one
  // card each, while the menus look normal. Every page is read daily, so the
  // badge floor catches it on the first broken day, and the gap full read
  // after the rejection catches it again while it lasts.
  for (const fault of ["broken", "cut"] as const) {
    const native = yard();
    const cold = await census(native, 600, null);
    for (const model of [0, 1]) native[fault].add(model);
    const published: string[] = [];
    await expect(census(native, 601, cold.terminal, published)).rejects.toThrow(
      BADGE_FLOOR,
    );
    await expect(census(native, 602, cold.terminal, published)).rejects.toThrow(
      BADGE_FLOOR,
    );
    expect(published).toHaveLength(0);
    // Repaired, the next run reads every page (gap) and publishes every donor.
    native[fault].clear();
    const repaired = await census(native, 603, cold.terminal);
    expect(repaired.models).toEqual(every(12));
    expect(repaired.vins).toEqual(allVins(native));
    expect(repaired.warnings.at(-1)).toBe(
      "Aplus Read 12 of 12 model pages (gap 12); carried 0.",
    );
  }
});

test("A Plus fails a page cut to one card against the last accepted census until the outage path", async () => {
  // With 24 models of 40 donors, one page cut to a single card while its badge
  // stays at 40 keeps 95.9% of today's badges, above the 95% badge floor, but
  // falls below 97% of what the last accepted census listed.
  const native = yard(24);
  const cold = await census(native, 600, null);
  native.cut.add(5);
  const published: string[] = [];
  await expect(census(native, 601, cold.terminal, published)).rejects.toThrow(
    REPLAY_FLOOR,
  );
  // The gap full read keeps the replay reference while it is under six days old.
  await expect(census(native, 605, cold.terminal, published)).rejects.toThrow(
    REPLAY_FLOOR,
  );
  expect(published).toHaveLength(0);
  // Six days after the last accepted run, the run is judged on the badge floor
  // alone, so the yard is not blocked indefinitely.
  const outage = await census(native, 606, cold.terminal);
  expect(outage.models.filter((m) => m === 5)).toHaveLength(2);
  expect(outage.warnings.at(-1)).toBe(
    "Aplus Read 24 of 24 model pages (gap 24); carried 0.",
  );
  expect(outage.vins).toContain(record(5, 1)[0]);
  expect(outage.vins).not.toContain(record(5, 2)[0]);
});

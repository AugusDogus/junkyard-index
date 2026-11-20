import { expect, test } from "bun:test";
import { Effect } from "effect";
import { DENTON_ABOUT, DENTON_CONTACT } from "./denton-client";
import { streamDentonInventory } from "./denton-connector";
import { DentonCursor } from "./denton-cursor";
import { DentonError } from "./denton-html";
import {
  dentonTestCard,
  dentonTestDocument,
  dentonTestGraph,
  dentonTestInventory,
  dentonTestVin,
} from "./denton-test-fixtures";
import { dentonHash } from "./denton-traversal";
import { DENTON_ARRIVALS, DENTON_MAKES } from "./denton-yard-metadata";
import { z } from "zod";
import {
  MODEL_CENSUS_DAY_MS,
  MODEL_CENSUS_SWEEP_DAYS,
  ModelCensus,
} from "./model-census";

const make = "https://dentonauto.com/used-parts/ACURA";
const label = (model: number) => "M" + model;
const modelUrl = (model: number) => `${make}/${label(model)}/`;
const models = Array.from({ length: 12 }, (_, i) => i);
/** The census key the Denton cursor binds to each model (make destination and
 * label, model destination and label). The cold-start test pins it. */
const censusKey = (model: number) =>
  JSON.stringify([make, "ACURA", modelUrl(model), label(model)]);
/** Models in `day`'s sweep slice, in published order. These fixture keys only
 * land on odd slices, so tests pick days whose slice is non-empty. */
const sweep = (day: number) =>
  models.filter(
    (model) =>
      ModelCensus.slice(censusKey(model)) === day % MODEL_CENSUS_SWEEP_DAYS,
  );
const outside = (...days: number[]) =>
  models.filter((model) => days.every((day) => !sweep(day).includes(model)));
const sorted = (list: Iterable<number>) =>
  [...new Set(list)].sort((a, b) => a - b);
const terminalKeys = (terminal: unknown) =>
  z
    .object({
      census: z.object({ models: z.array(z.object({ key: z.string() })) }),
    })
    .parse(terminal)
    .census.models.map((m) => m.key);
/** A donor is [model, ordinal]; its stock, VIN and destination derive from both. */
type Donor = readonly [number, number];
const index = ([model, n]: Donor) => model * 1000 + n;
const card = (donor: Donor) => dentonTestCard(index(donor), label(donor[0]));
const donors = (model: number, n = 70): Donor[] =>
  Array.from({ length: n }, (_, i) => [model, i + 1] as const);
const empty = "No Results Found. Try Browsing Our Parts Or Search Again";

/** Twelve models with 70 donors each (above the 765 floor); `rows` and the
 * arrivals list can be edited between runs. `staged` holds every VIN any run
 * handed to `onBatch`. */
function yard() {
  const owner = dentonTestGraph({ accepted: 1 }).pages;
  const rows = new Map(models.map((i) => [i, donors(i)]));
  let arrivals: Donor[] = [];
  /** Models whose page renders the native empty result while the menu badge
   * still counts their rows (the TOWN & COUNTRY pattern). */
  const unreachable = new Set<number>();
  /** Extra cards a model page lists beyond its menu badge (a menu served
   * from a stale page cache while the model page is fresh). */
  const surplus = new Map<number, number>();
  const calls: string[] = [];
  const staged: string[] = [];
  const body = (url: string) => {
    if (url === DENTON_ABOUT || url === DENTON_CONTACT) return owner.get(url);
    if (url === DENTON_MAKES) {
      const total = [...rows.values()].reduce((n, list) => n + list.length, 0);
      return dentonTestInventory(
        `<div class="iisMakesMenu"><a href="${make}">ACURA <span class="badge">${total}</span></a></div>`,
      );
    }
    if (url === make + "/")
      return dentonTestInventory(
        `<div id="menumodellist">${[...rows]
          .map(
            ([model, list]) =>
              `<a href="${modelUrl(model)}">${label(model)} <span class="badge">${list.length}</span></a>`,
          )
          .join("")}</div>`,
      );
    if (url === DENTON_ARRIVALS)
      return dentonTestDocument(
        `<div class="card-deck">${arrivals.length ? arrivals.map(card).join("") : empty}</div>`,
      );
    const model = /\/ACURA\/M(\d+)\/$/.exec(url)?.[1];
    const list = model === undefined ? undefined : rows.get(Number(model));
    const extra = Array.from(
      { length: surplus.get(Number(model)) ?? 0 },
      (_, i): Donor => [Number(model), 500 + i],
    );
    return (
      list &&
      dentonTestInventory(
        (unreachable.has(Number(model))
          ? ""
          : [...list, ...extra].map(card).join("")) || empty,
      )
    );
  };
  const read = (url: string) =>
    Effect.suspend(() => {
      calls.push(url);
      const page = body(url);
      return page === undefined
        ? Effect.fail(DentonError.create("fixture", "No saved page at " + url))
        : Effect.succeed({ kind: "document" as const, url, body: page });
    });
  return {
    rows,
    calls,
    read,
    unreachable,
    surplus,
    staged,
    setArrivals: (next: Donor[]) => {
      arrivals = next;
    },
    vins: () =>
      [
        ...new Set(
          [...[...rows.values()].flat(), ...arrivals].map((donor) =>
            dentonTestVin(index(donor)),
          ),
        ),
      ].sort(),
  };
}

/** One full run on `day`, seeded by the previous terminal cursor. */
async function census(
  native: ReturnType<typeof yard>,
  day: number,
  previousCursor: unknown,
  previousAcceptedCount: number | null = null,
) {
  const before = native.calls.length;
  let wire: string | undefined;
  const vins: string[] = [];
  const warnings: string[] = [];
  for (;;) {
    const result = await Effect.runPromise(
      streamDentonInventory({
        previousAcceptedCount,
        startCursor: wire,
        // Only the first chunk may adopt a census; later chunks must not.
        previousCursor,
        now: () => day * MODEL_CENSUS_DAY_MS + 7 * 60 * 60 * 1000,
        readPage: native.read,
        maxPages: 8,
        onBatch: (batch) =>
          Effect.sync(() => {
            vins.push(...batch.map((v) => v.vin));
            native.staged.push(...batch.map((v) => v.vin));
          }),
      }),
    );
    warnings.push(...result.warnings);
    const encoded = DentonCursor.serialize(
      result.cursor,
      previousAcceptedCount,
    );
    if (!encoded.ok) throw new Error(encoded.error.message);
    wire = encoded.value;
    if (result.status === "complete") break;
  }
  const calls = native.calls.slice(before);
  return {
    terminal: JSON.parse(wire) as unknown,
    requests: calls.length,
    models: calls.flatMap((url) => {
      const model = /\/ACURA\/M(\d+)\/$/.exec(url)?.[1];
      return model === undefined ? [] : [Number(model)];
    }),
    vins: vins.sort(),
    warnings,
  };
}

test("Denton cold start reads every model and publishes its census", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  expect(cold.models).toEqual(models);
  // Sweep expectations below derive from these exact keys.
  expect(terminalKeys(cold.terminal)).toEqual(models.map(censusKey));
  // about, contact, makes, one menu, arrivals, 12 models; closing about,
  // contact and makes.
  expect(cold.requests).toBe(20);
  expect(cold.vins).toEqual(native.vins());
  expect(cold.warnings).toHaveLength(2);
  expect(cold.warnings.at(-1)).toBe(
    "Denton Read 12 of 12 model pages (cold 12); carried 0.",
  );
});

test("Denton carries unread models, rotates the sweep and reads changes", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // Day 601: only the sweep slice (slice(key) === 601 % 6) is read.
  expect(sweep(601).length).toBeGreaterThan(0);
  const next = await census(native, 601, cold.terminal);
  expect(next.models).toEqual(sweep(601));
  expect(next.requests).toBe(8 + sweep(601).length);
  // Carried donors are still published in full.
  expect(next.vins).toEqual(native.vins());

  // A second run on day 601 carries every model without a model GET.
  const idle = await census(native, 601, next.terminal);
  expect(idle.models).toEqual([]);
  expect(idle.requests).toBe(8);
  expect(idle.vins).toEqual(native.vins());
  expect(idle.warnings.at(-1)).toBe(
    "Denton Read 0 of 12 model pages; carried 12.",
  );

  // Day 603: the sweep rotates to another non-empty slice. Outside it, a sold
  // donor changes one model's count; on another a donor is swapped for an
  // arrival at the same count, which only the arrival reveals.
  expect(sweep(603).length).toBeGreaterThan(0);
  expect(sweep(603).some((model) => sweep(601).includes(model))).toBe(false);
  const [sold, swapped] = outside(603);
  if (sold === undefined || swapped === undefined)
    throw new Error("Expected two models outside day 603's sweep slice");
  native.rows.set(sold, donors(sold, 69));
  const arrival: Donor = [swapped, 71];
  native.rows.set(swapped, [...donors(swapped).slice(1), arrival]);
  native.setArrivals([arrival]);
  const changed = await census(native, 603, idle.terminal);
  expect(changed.models).toEqual(sorted([...sweep(603), sold, swapped]));
  expect(changed.vins).toEqual(native.vins());
  const changedReads = sweep(603).length + 2;
  const changedSummary = changed.warnings.at(-1) ?? "";
  // Reasons are listed in published model order.
  expect(changedSummary).toStartWith(
    `Denton Read ${changedReads} of 12 model pages (`,
  );
  expect(changedSummary).toContain(`sweep ${sweep(603).length}`);
  expect(changedSummary).toContain("count 1");
  expect(changedSummary).toContain("trigger 1");
  expect(changedSummary).toEndWith(`carried ${12 - changedReads}.`);

  // Day 605 and 606: an arrival not yet on its model page keeps that model
  // due every day, while the arrivals page still publishes the donor.
  const waiting = outside(605, 606).find(
    (model) => model !== sold && model !== swapped,
  );
  if (waiting === undefined)
    throw new Error("Expected a model outside day 605 and 606 sweep slices");
  const pending: Donor = [waiting, 99];
  native.setArrivals([pending]);
  const first = await census(native, 605, changed.terminal);
  expect(first.models).toEqual(sorted([...sweep(605), waiting]));
  expect(first.vins).toContain(dentonTestVin(index(pending)));
  const second = await census(native, 606, first.terminal);
  // Days 602 and 604 had no run, so models last read by the day 600 cold
  // census reach the six-day ceiling on day 606.
  const readSince = new Set([
    ...next.models,
    ...changed.models,
    ...first.models,
  ]);
  const stale = models.filter((model) => !readSince.has(model));
  expect(second.models).toEqual(sorted([...sweep(606), waiting, ...stale]));
  expect(second.vins).toEqual(native.vins());
  expect(second.warnings.at(-1)).toContain("trigger 1");
}, 30_000);

test("Denton re-reads every model within six days, even across missed runs", async () => {
  const native = yard();
  let previous = (await census(native, 600, null)).terminal;
  const lastRead = new Map<number, number>();
  for (let i = 0; i < 12; i++) lastRead.set(i, 600);
  const reads: number[] = [];
  // Day 606 also reads the slices of missed days 601 and 602 at the ceiling.
  const expected = (day: number) =>
    day === 606
      ? sorted([...sweep(601), ...sweep(602), ...sweep(606)])
      : sweep(day);
  // Skip day 601 and 602 entirely, then run daily.
  for (const day of [603, 604, 605, 606, 607, 608, 609, 610, 611, 612]) {
    const run = await census(native, day, previous);
    expect(run.models).toEqual(expected(day));
    for (const model of run.models) lastRead.set(model, day);
    for (const read of lastRead.values()) expect(day - read).toBeLessThan(6);
    expect(run.vins).toEqual(native.vins());
    reads.push(run.models.length);
    previous = run.terminal;
  }
  // Once the missed-day catch-up is read, each day reads exactly its slice,
  // and the six slices cover every model once.
  const steady = [607, 608, 609, 610, 611, 612];
  expect(reads.slice(4)).toEqual(steady.map((day) => sweep(day).length));
  expect(sorted(steady.flatMap(sweep))).toEqual(models);
  expect(steady.flatMap(sweep)).toHaveLength(models.length);
}, 30_000);

test("Denton rejects a run whose read and carried model cards fall short of today's model badges", async () => {
  // 1,800 badges keep the broken run above the 765 floor.
  const native = yard();
  for (const model of native.rows.keys())
    native.rows.set(model, donors(model, 150));
  const cold = await census(native, 600, null);
  // A small unreachable model stays within the badge tolerance.
  native.rows.set(3, donors(3, 20));
  native.unreachable.add(3);
  const small = await census(native, 601, cold.terminal);
  // Its empty page differs from its badge, so closing confirms it once more.
  expect(small.models).toEqual([...sorted([...sweep(601), 3]), 3]);
  // On day 605 every model page renders the native empty result while badges
  // hold. No evidence is past the ceiling and only the (non-empty) sweep slice
  // is read, so the 765 floor and the 50% prior guard would pass on the
  // carried pages; the badge deficit must not.
  expect(sweep(605).length).toBeGreaterThan(0);
  expect(sweep(605).length).toBeLessThan(4);
  for (const model of models) native.unreachable.add(model);
  const before = native.calls.length;
  const staged = native.staged.length;
  await expect(
    census(native, 605, small.terminal, small.vins.length),
  ).rejects.toThrow("below the 95% coverage floor");
  expect(native.staged).toHaveLength(staged);
  // Only the sweep slice was read, then confirmed at closing (each empty page
  // differs from its badge), before the union was rejected.
  expect(
    native.calls.slice(before).filter((url) => /\/M\d+\/$/.test(url)),
  ).toEqual([...sweep(605), ...sweep(605)].map(modelUrl));
}, 30_000);

test("Denton caps each model's cards at its badge, so a surplus page cannot hide an empty sweep slice", async () => {
  // 1,800 badges keep the broken run above the 765 floor.
  const native = yard();
  for (const model of native.rows.keys())
    native.rows.set(model, donors(model, 150));
  const broken = sweep(605);
  expect(broken.length).toBeGreaterThan(0);
  expect(broken.length).toBeLessThan(4);
  // Every other model lists enough cards beyond its badge to make up the
  // whole broken slice: a plain card sum would still match the badges.
  const others = models.filter((model) => !broken.includes(model));
  const extra = Math.ceil((150 * broken.length) / others.length);
  for (const model of others) native.surplus.set(model, extra);
  const cold = await census(native, 600, null);
  // Surplus pages differ from their badges, so closing confirmed each one.
  expect(cold.models).toEqual([...models, ...others]);
  // Day 605: the sweep slice renders empty while its badges hold; the surplus
  // pages are carried (read five days ago, outside today's slice).
  for (const model of broken) native.unreachable.add(model);
  const staged = native.staged.length;
  await expect(
    census(native, 605, cold.terminal, cold.vins.length),
  ).rejects.toThrow(
    `Denton model pages list ${1800 - 150 * broken.length} of 1800 cards`,
  );
  expect(native.staged).toHaveLength(staged);
}, 30_000);

test("Denton treats an unreadable or incompatible previous cursor as a warned cold census", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const terminal = cold.terminal;
  if (
    typeof terminal !== "object" ||
    terminal === null ||
    !("census" in terminal) ||
    typeof terminal.census !== "object" ||
    terminal.census === null
  )
    throw new Error("Expected a terminal census");
  const resign = (value: object) => ({
    ...value,
    checksum: dentonHash({ ...value, checksum: undefined }),
  });
  for (const [previous, warning] of [
    [{ source: "denton", junk: true }, "not a readable terminal census"],
    // A tampered terminal fails its integrity check.
    [
      { ...terminal, census: { ...terminal.census, day: 599 } },
      "not a readable terminal census",
    ],
    [
      resign({ ...terminal, census: { ...terminal.census, contract: "old" } }),
      "another parser or traversal contract",
    ],
  ] as const) {
    const run = await census(native, 601, previous);
    expect(run.models).toHaveLength(12);
    expect(run.warnings[0]).toContain(warning);
    expect(run.warnings[0]).toContain("reading every model page");
  }
  const future = await census(native, 599, terminal);
  expect(future.models).toHaveLength(12);
  expect(future.warnings[0]).toContain("dated after this run");
}, 30_000);

test("Denton checkpoints reject carried pages that differ from the census, skipped carries and charged carries", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // Day 601 opening up to arrivals: model 0 is carried before the first sweep
  // read.
  expect(sweep(601)[0]).toBeGreaterThan(0);
  const part = await Effect.runPromise(
    streamDentonInventory({
      previousAcceptedCount: null,
      previousCursor: cold.terminal,
      now: () => 601 * MODEL_CENSUS_DAY_MS,
      readPage: native.read,
      maxPages: 5,
      onBatch: () => Effect.die("unexpected staging"),
    }),
  );
  const cursor = part.cursor;
  if (cursor.phase !== "active") throw new Error("Expected a paused census");
  expect(cursor.requests).toBe(5);
  const carried = cursor.opening.at(-1);
  if (carried?.kind !== "model") throw new Error("Expected a carried model");
  const resign = (value: object) => ({
    ...value,
    checksum: dentonHash({ ...value, checksum: undefined }),
  });
  expect(DentonCursor.parse(cursor, null).ok).toBe(true);
  for (const [tampered, message] of [
    [
      {
        ...cursor,
        opening: [
          ...cursor.opening.slice(0, -1),
          {
            ...carried,
            page: { ...carried.page, records: carried.page.records.slice(1) },
          },
        ],
      },
      "differs from its accepted census",
    ],
    [{ ...cursor, opening: cursor.opening.slice(0, -1) }, "not due for a read"],
    [
      {
        ...cursor,
        requests: cursor.requests + 1,
        bytes: cursor.bytes + carried.receipt.bytes,
      },
      "accounting is inconsistent",
    ],
    [{ ...cursor, day: null }, "run day or previous model census"],
  ] as const) {
    const parsed = DentonCursor.parse(resign(tampered), null);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.message).toContain(message);
  }
});

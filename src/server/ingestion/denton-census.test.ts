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
import { MODEL_CENSUS_DAY_MS } from "./model-census";

const make = "https://dentonauto.com/used-parts/ACURA";
const label = (model: number) => "M" + model;
const modelUrl = (model: number) => `${make}/${label(model)}/`;
/** A donor is [model, ordinal]; its stock, VIN and destination derive from both. */
type Donor = readonly [number, number];
const index = ([model, n]: Donor) => model * 1000 + n;
const card = (donor: Donor) => dentonTestCard(index(donor), label(donor[0]));
const donors = (model: number, n = 70): Donor[] =>
  Array.from({ length: n }, (_, i) => [model, i + 1] as const);
const empty = "No Results Found. Try Browsing Our Parts Or Search Again";

/** Twelve models with 70 donors each (above the 765 floor); `rows` and the
 * arrivals list can be edited between runs. */
function yard() {
  const owner = dentonTestGraph({ accepted: 1 }).pages;
  const rows = new Map(Array.from({ length: 12 }, (_, i) => [i, donors(i)]));
  let arrivals: Donor[] = [];
  const calls: string[] = [];
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
    return list && dentonTestInventory(list.map(card).join("") || empty);
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
) {
  const before = native.calls.length;
  let wire: string | undefined;
  const vins: string[] = [];
  const warnings: string[] = [];
  for (;;) {
    const result = await Effect.runPromise(
      streamDentonInventory({
        previousAcceptedCount: null,
        startCursor: wire,
        // Only the first chunk may adopt a census; later chunks must not.
        previousCursor,
        now: () => day * MODEL_CENSUS_DAY_MS + 7 * 60 * 60 * 1000,
        readPage: native.read,
        maxPages: 8,
        onBatch: (batch) =>
          Effect.sync(() => {
            vins.push(...batch.map((v) => v.vin));
          }),
      }),
    );
    warnings.push(...result.warnings);
    const encoded = DentonCursor.serialize(result.cursor, null);
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
  expect(cold.models).toEqual(Array.from({ length: 12 }, (_, i) => i));
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
  // Day 601: only the sweep slice (ordinal % 6 === 601 % 6) is read.
  const next = await census(native, 601, cold.terminal);
  expect(next.models).toEqual([1, 7]);
  expect(next.requests).toBe(10);
  // Carried donors are still published in full.
  expect(next.vins).toEqual(native.vins());

  // Day 602: a sold donor changes model 4's count; on model 9 a donor is
  // swapped for an arrival at the same count, which only the arrival reveals.
  native.rows.set(4, donors(4, 69));
  const arrival: Donor = [9, 71];
  native.rows.set(9, [...donors(9).slice(1), arrival]);
  native.setArrivals([arrival]);
  const changed = await census(native, 602, next.terminal);
  expect(changed.models).toEqual([2, 4, 8, 9]);
  expect(changed.vins).toEqual(native.vins());
  expect(changed.warnings.at(-1)).toBe(
    "Denton Read 4 of 12 model pages (sweep 2, count 1, trigger 1); carried 8.",
  );

  // Day 603 and 604: an arrival not yet on its model page keeps that model
  // due every day, while the arrivals page still publishes the donor.
  const pending: Donor = [5, 99];
  native.setArrivals([pending]);
  const first = await census(native, 603, changed.terminal);
  expect(first.models).toEqual([3, 5, 9]);
  expect(first.vins).toContain(dentonTestVin(index(pending)));
  const second = await census(native, 604, first.terminal);
  expect(second.models).toEqual([4, 5, 10]);
  expect(second.vins).toEqual(native.vins());
}, 30_000);

test("Denton re-reads every model within six days, even across missed runs", async () => {
  const native = yard();
  let previous = (await census(native, 600, null)).terminal;
  const lastRead = new Map<number, number>();
  for (let i = 0; i < 12; i++) lastRead.set(i, 600);
  const reads: number[] = [];
  // Skip day 601 and 602 entirely, then run daily.
  for (const day of [603, 604, 605, 606, 607, 608, 609, 610, 611, 612]) {
    const run = await census(native, day, previous);
    for (const model of run.models) lastRead.set(model, day);
    for (const read of lastRead.values()) expect(day - read).toBeLessThan(6);
    expect(run.vins).toEqual(native.vins());
    reads.push(run.models.length);
    previous = run.terminal;
  }
  // About a sixth of the models a day once the missed-day catch-up is read.
  expect(reads.slice(4)).toEqual([2, 2, 2, 2, 2, 2]);
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
  // Day 601 opening up to arrivals: model 0 is carried before model 1's read.
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

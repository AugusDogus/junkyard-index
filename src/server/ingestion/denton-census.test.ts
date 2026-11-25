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
import { MODEL_CENSUS_DAY_MS } from "./model-census";

const make = "https://dentonauto.com/used-parts/ACURA";
const label = (model: number) => "M" + model;
const modelUrl = (model: number) => `${make}/${label(model)}/`;
const models = Array.from({ length: 12 }, (_, i) => i);
/** The census key the Denton cursor binds to each model (make destination and
 * label, model destination and label). The cold-start test pins it. */
const censusKey = (model: number) =>
  JSON.stringify([make, "ACURA", modelUrl(model), label(model)]);
const terminalKeys = (terminal: unknown) =>
  z
    .object({
      census: z.object({ models: z.array(z.object({ key: z.string() })) }),
    })
    .parse(terminal)
    .census.models.map((m) => m.key);
/** A donor is [model, ordinal]; its stock, VIN and destination derive from both. */
type Donor = readonly [number, number];
/** The stored census evidence of `model`, without its page. */
const evidenceOf = (terminal: unknown, model: number) =>
  z
    .object({
      census: z.object({
        models: z.array(
          z.object({
            key: z.string(),
            count: z.number(),
            readDay: z.number(),
            expected: z.number(),
            lowSince: z.number().nullable(),
            surplusConfirmed: z.boolean(),
            confirmed: z.boolean(),
          }),
        ),
      }),
    })
    .parse(terminal)
    .census.models.find((m) => m.key === censusKey(model));
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
  /** Models whose page lists only its first card while the menu badge still
   * counts every row. */
  const cut = new Set<number>();
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
    const listed = [...(list ?? []), ...extra];
    return (
      list &&
      dentonTestInventory(
        (unreachable.has(Number(model))
          ? ""
          : (cut.has(Number(model)) ? listed.slice(0, 1) : listed)
              .map(card)
              .join("")) || empty,
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
    cut,
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
    /** Every VIN a full read publishes: badge rows, arrivals and the surplus
     * cards model pages list beyond their badges. */
    listedVins: () =>
      [
        ...new Set(
          [
            ...[...rows.values()].flat(),
            ...arrivals,
            ...[...surplus].flatMap(([model, n]) =>
              Array.from({ length: n }, (_, i): Donor => [model, 500 + i]),
            ),
          ].map((donor) => dentonTestVin(index(donor))),
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
  // Census evidence lookups below derive from these exact keys.
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

test("Denton reads every model page on every incremental run and publishes every donor", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // Day 601: an unchanged badge proves nothing, so every model page is read
  // again (daily) and nothing is carried. The run costs what a cold one does.
  const next = await census(native, 601, cold.terminal);
  expect(next.models).toEqual(models);
  expect(next.requests).toBe(cold.requests);
  expect(next.vins).toEqual(native.vins());
  expect(next.warnings.at(-1)).toBe(
    "Denton Read 12 of 12 model pages (daily 12); carried 0.",
  );

  // A second run on day 601 reads every model page again.
  const again = await census(native, 601, next.terminal);
  expect(again.models).toEqual(models);
  expect(again.requests).toBe(20);
  expect(again.vins).toEqual(native.vins());
  expect(again.warnings.at(-1)).toBe(
    "Denton Read 12 of 12 model pages (daily 12); carried 0.",
  );

  // Day 602: a sold donor changes one model's count; on another a donor is
  // swapped for an arrival at the same count, which the arrival names. Both
  // keep their own reasons; every other page is read daily.
  const sold = 4;
  const swapped = 7;
  native.rows.set(sold, donors(sold, 69));
  const arrival: Donor = [swapped, 71];
  native.rows.set(swapped, [...donors(swapped).slice(1), arrival]);
  native.setArrivals([arrival]);
  const changed = await census(native, 602, again.terminal);
  expect(changed.models).toEqual(models);
  expect(changed.requests).toBe(20);
  expect(changed.vins).toEqual(native.vins());
  // Reasons are listed in published model order.
  expect(changed.warnings.at(-1)).toBe(
    "Denton Read 12 of 12 model pages (daily 10, count 1, trigger 1); carried 0.",
  );

  // Day 603: the arrival is on its model page, so nothing is triggered.
  const quiet = await census(native, 603, changed.terminal);
  expect(quiet.models).toEqual(models);
  expect(quiet.vins).toEqual(native.vins());
  expect(quiet.warnings.at(-1)).toBe(
    "Denton Read 12 of 12 model pages (daily 12); carried 0.",
  );

  // Days 604 and 605: an arrival not yet on its model page labels that read
  // a trigger every day, while the arrivals page still publishes the donor.
  const waiting = 9;
  const pending: Donor = [waiting, 99];
  native.setArrivals([pending]);
  let previous = quiet;
  for (const day of [604, 605]) {
    const run = await census(native, day, previous.terminal);
    expect(run.models).toEqual(models);
    expect(run.requests).toBe(20);
    expect(run.vins).toContain(dentonTestVin(index(pending)));
    expect(run.vins).toEqual(native.vins());
    expect(run.warnings.at(-1)).toBe(
      "Denton Read 12 of 12 model pages (daily 11, trigger 1); carried 0.",
    );
    previous = run;
  }
}, 120_000);

test("Denton reads a model whose donor is swapped under an unchanged badge and publishes the new donor", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const healthy = await census(native, 601, cold.terminal, cold.vins.length);
  // Day 602: one donor of model 5 is crushed and another placed under the same
  // model. The badge stays at 70 and no arrival names the newcomer, so only a
  // read of the page itself reveals the swap.
  const model = 5;
  const crushed: Donor = [model, 1];
  const placed: Donor = [model, 71];
  native.rows.set(model, [...donors(model).slice(1), placed]);
  expect(native.rows.get(model)).toHaveLength(70);
  const swapped = await census(
    native,
    602,
    healthy.terminal,
    healthy.vins.length,
  );
  expect(swapped.models).toEqual(models);
  expect(swapped.requests).toBe(20);
  expect(swapped.warnings.at(-1)).toBe(
    "Denton Read 12 of 12 model pages (daily 12); carried 0.",
  );
  expect(swapped.vins).toContain(dentonTestVin(index(placed)));
  expect(swapped.vins).not.toContain(dentonTestVin(index(crushed)));
  expect(swapped.vins).toEqual(native.vins());
  expect(evidenceOf(swapped.terminal, model)).toEqual({
    key: censusKey(model),
    count: 70,
    readDay: 602,
    expected: 70,
    lowSince: null,
    surplusConfirmed: true,
    confirmed: false,
  });
}, 120_000);

test("Denton reads every model on every run, across missed runs", async () => {
  const native = yard();
  let previous = (await census(native, 600, null)).terminal;
  const summaries: string[] = [];
  // Skip day 601 and 602 entirely, then run daily.
  for (const day of [603, 604, 605, 606, 607, 608, 609, 610, 611, 612]) {
    const run = await census(native, day, previous);
    expect(run.models).toEqual(models);
    expect(run.requests).toBe(20);
    expect(run.vins).toEqual(native.vins());
    summaries.push(run.warnings.at(-1) ?? "");
    previous = run.terminal;
  }
  // Day 603 follows missed days 601 and 602, so its reads are labelled gap.
  expect(summaries[0]).toBe(
    "Denton Read 12 of 12 model pages (gap 12); carried 0.",
  );
  for (const summary of summaries.slice(1))
    expect(summary).toBe(
      "Denton Read 12 of 12 model pages (daily 12); carried 0.",
    );
}, 120_000);

test("Denton rejects a run whose model cards fall short of today's model badges", async () => {
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
  expect(small.models).toEqual([...models, 3]);
  // Daily runs through day 604 read every page. The confirmed empty page
  // repeats its evidence, so closing no longer re-reads it.
  let previous = small;
  for (const day of [602, 603, 604]) {
    const run = await census(
      native,
      day,
      previous.terminal,
      previous.vins.length,
    );
    expect(run.models).toEqual(models);
    previous = run;
  }
  // On day 605 model 11 renders the native empty result while its badge holds.
  // Its 150 lost donors leave 1,500, above the 765 floor and the 50% prior
  // guard; the badge deficit (1,500 of 1,670, below 95%) must fail the run.
  native.unreachable.add(11);
  const before = native.calls.length;
  const staged = native.staged.length;
  await expect(
    census(native, 605, previous.terminal, previous.vins.length),
  ).rejects.toThrow(
    "Denton model pages list 1500 of 1670 cards promised by today's model counts, below the 95% coverage floor",
  );
  expect(native.staged).toHaveLength(staged);
  // Every page was read, then the newly empty page was re-read at closing
  // before the union was rejected. The confirmed empty page repeated its
  // evidence, so closing skipped it.
  expect(
    native.calls.slice(before).filter((url) => /\/M\d+\/$/.test(url)),
  ).toEqual([...models, 11].map(modelUrl));
}, 120_000);

test("Denton caps each model's cards at its badge, so surplus pages cannot hide an empty page", async () => {
  // 1,800 badges keep the broken run above the 765 floor.
  const native = yard();
  for (const model of native.rows.keys())
    native.rows.set(model, donors(model, 150));
  const broken = [11];
  // Every other model lists enough cards beyond its badge to make up the
  // whole broken page: a plain card sum would still match the badges.
  const others = models.filter((model) => !broken.includes(model));
  const extra = Math.ceil((150 * broken.length) / others.length);
  expect(extra * others.length).toBeGreaterThanOrEqual(150 * broken.length);
  for (const model of others) native.surplus.set(model, extra);
  const cold = await census(native, 600, null);
  // Surplus pages differ from their badges, so closing confirmed each one.
  expect(cold.models).toEqual([...models, ...others]);
  // A surplus first seen on a cold read is unconfirmed: a fault on that one
  // day could hide real cards behind the placeholders.
  const surplusEvidence = (
    terminal: unknown,
    model: number,
    readDay: number,
    surplusConfirmed: boolean,
  ) =>
    expect(evidenceOf(terminal, model)).toEqual({
      key: censusKey(model),
      count: 150,
      readDay,
      expected: 150 + extra,
      lowSince: null,
      surplusConfirmed,
      confirmed: false,
    });
  for (const model of others) surplusEvidence(cold.terminal, model, 600, false);
  for (const model of broken)
    expect(evidenceOf(cold.terminal, model)).toEqual({
      key: censusKey(model),
      count: 150,
      readDay: 600,
      expected: 150,
      lowSince: null,
      surplusConfirmed: true,
      confirmed: false,
    });
  // Day 601, the first normal incremental run, reads every surplus page again
  // (short) and the rest daily, and closing re-reads each surplus page; that
  // run confirms the surplus.
  const confirming = await census(native, 601, cold.terminal, cold.vins.length);
  expect(confirming.models).toEqual([...models, ...others]);
  expect(confirming.requests).toBe(8 + models.length + others.length);
  expect(confirming.vins).toEqual(native.listedVins());
  expect(confirming.warnings.at(-1)).toBe(
    `Denton Read 12 of 12 model pages (short ${others.length}, daily ${broken.length}); carried 0.`,
  );
  for (const model of others)
    surplusEvidence(confirming.terminal, model, 601, true);
  // Day 602 reads every page again and keeps the confirmed surplus. The
  // surplus pages repeat their confirmed evidence, so closing skips them.
  const previous = await census(
    native,
    602,
    confirming.terminal,
    confirming.vins.length,
  );
  expect(previous.models).toEqual(models);
  expect(previous.vins).toEqual(native.listedVins());
  for (const model of others)
    surplusEvidence(previous.terminal, model, 602, true);
  // Day 603: the broken page renders empty while its badge holds; the surplus
  // pages, read the same day, still list more than their badges.
  for (const model of broken) native.unreachable.add(model);
  const before = native.calls.length;
  const staged = native.staged.length;
  await expect(
    census(native, 603, previous.terminal, previous.vins.length),
  ).rejects.toThrow(
    `Denton model pages list ${1800 - 150 * broken.length} of 1800 cards`,
  );
  expect(native.staged).toHaveLength(staged);
  // Every page was read, then the newly empty page was re-read at closing
  // before the union was rejected. The surplus pages repeated their
  // confirmed evidence, so closing skipped them.
  expect(
    native.calls.slice(before).filter((url) => /\/M\d+\/$/.test(url)),
  ).toEqual([...models, ...broken].map(modelUrl));
}, 120_000);

test("Denton rejects a run whose small model pages are cut to one card each while menus keep their badges", async () => {
  // Three small models cut to one card each keep 95.96% of today's badges
  // (above the 95% badge floor) while the replay floor over their last
  // accepted cards must still fail the run.
  const broken = [1, 4, 7];
  const native = yard();
  for (const model of models)
    native.rows.set(model, donors(model, broken.includes(model) ? 20 : 150));
  const cold = await census(native, 600, null);
  // Day 601 runs too, so day 602 is a normal incremental run.
  const healthy = await census(native, 601, cold.terminal, cold.vins.length);
  expect(healthy.models).toEqual(models);
  for (const model of broken) native.cut.add(model);
  const before = native.calls.length;
  const staged = native.staged.length;
  const lost = 19 * broken.length;
  const total = 150 * (models.length - broken.length) + 20 * broken.length;
  expect((total - lost) / total).toBeGreaterThan(0.95);
  await expect(
    census(native, 602, healthy.terminal, healthy.vins.length),
  ).rejects.toThrow(
    `Denton model pages list ${total - lost} of ${total} cards that the last accepted census listed, less any drop in their counts, below the 97% coverage floor`,
  );
  expect(native.staged).toHaveLength(staged);
  // Every page was read, then each cut page was confirmed at closing (it
  // differs from its badge), before the union was rejected.
  expect(
    native.calls.slice(before).filter((url) => /\/M\d+\/$/.test(url)),
  ).toEqual([...models, ...broken].map(modelUrl));
}, 120_000);

test("Denton confirms a surplus page that falls to its badge at closing and re-reads it on the next run", async () => {
  // Model 0 lists ten cards beyond its badge (placeholder or surplus rows).
  const model = 0;
  const native = yard();
  native.surplus.set(model, 10);
  /** The stored census evidence of the surplus model. */
  const evidence = (terminal: unknown) => evidenceOf(terminal, model);
  const cold = await census(native, 600, null);
  // The surplus first seen on the cold read is unconfirmed.
  expect(evidence(cold.terminal)).toEqual({
    key: censusKey(model),
    count: 70,
    readDay: 600,
    expected: 80,
    lowSince: null,
    surplusConfirmed: false,
    confirmed: false,
  });
  // Day 601, a normal incremental run, reads the surplus page again (short)
  // and every other page daily, and closing re-reads it; that run confirms the
  // surplus.
  const confirming = await census(native, 601, cold.terminal, cold.vins.length);
  expect(confirming.models).toEqual([...models, model]);
  expect(confirming.requests).toBe(8 + models.length + 1);
  expect(confirming.vins).toEqual(native.listedVins());
  expect(confirming.warnings.at(-1)).toBe(
    "Denton Read 12 of 12 model pages (short 1, daily 11); carried 0.",
  );
  expect(evidence(confirming.terminal)).toEqual({
    key: censusKey(model),
    count: 70,
    readDay: 601,
    expected: 80,
    lowSince: null,
    surplusConfirmed: true,
    confirmed: false,
  });
  // Day 602 reads the confirmed surplus page daily. It still lists more than
  // its badge, but repeats its confirmed evidence, so closing skips it.
  const steady = await census(
    native,
    602,
    confirming.terminal,
    confirming.vins.length,
  );
  expect(steady.models).toEqual(models);
  expect(steady.requests).toBe(8 + models.length);
  expect(steady.warnings.at(-1)).toBe(
    "Denton Read 12 of 12 model pages (daily 12); carried 0.",
  );
  expect(evidence(steady.terminal)).toEqual({
    key: censusKey(model),
    count: 70,
    readDay: 602,
    expected: 80,
    lowSince: null,
    surplusConfirmed: true,
    confirmed: false,
  });
  let previous = steady;
  // Day 603: its page loses ten real cards and now lists exactly its badge.
  // A cards === badge check would not re-read it; it fell below the 80 cards
  // it is expected to list, so closing re-reads it. The surplus is sticky:
  // one read at the badge does not erase it.
  native.surplus.delete(model);
  const lost = await census(
    native,
    603,
    previous.terminal,
    previous.vins.length,
  );
  expect(lost.models).toEqual([...models, model]);
  expect(lost.requests).toBe(8 + models.length + 1);
  expect(lost.vins).toEqual(native.vins());
  expect(lost.warnings.at(-1)).toBe(
    "Denton Read 12 of 12 model pages (daily 12); carried 0.",
  );
  expect(evidence(lost.terminal)).toEqual({
    key: censusKey(model),
    count: 70,
    readDay: 603,
    expected: 80,
    lowSince: 603,
    surplusConfirmed: true,
    confirmed: false,
  });
  // Days 604 to 608: the page still lists only its badge. A re-read cannot
  // tell a real loss from a transient one, so the lower count is not accepted:
  // each run reads it again (short) and closing re-reads it, while the surplus
  // and the day the low reads began are kept.
  previous = lost;
  for (const day of [604, 605, 606, 607, 608]) {
    const run = await census(
      native,
      day,
      previous.terminal,
      previous.vins.length,
    );
    expect(run.models).toEqual([...models, model]);
    expect(run.requests).toBe(8 + models.length + 1);
    expect(run.vins).toEqual(native.vins());
    expect(run.warnings.at(-1)).toBe(
      "Denton Read 12 of 12 model pages (short 1, daily 11); carried 0.",
    );
    expect(evidence(run.terminal)).toEqual({
      key: censusKey(model),
      count: 70,
      readDay: day,
      expected: 80,
      lowSince: 603,
      surplusConfirmed: true,
      confirmed: false,
    });
    previous = run;
  }
  // Day 609 (lowSince + 6) is a normal incremental run: it reads the page
  // (short), closing re-reads it, and the surplus is lowered to what the page
  // lists.
  expect(609 - 603).toBe(6);
  const lowering = await census(
    native,
    609,
    previous.terminal,
    previous.vins.length,
  );
  expect(lowering.models).toEqual([...models, model]);
  expect(lowering.requests).toBe(8 + models.length + 1);
  expect(lowering.vins).toEqual(native.vins());
  expect(lowering.warnings.at(-1)).toBe(
    "Denton Read 12 of 12 model pages (short 1, daily 11); carried 0.",
  );
  expect(evidence(lowering.terminal)).toEqual({
    key: censusKey(model),
    count: 70,
    readDay: 609,
    expected: 70,
    lowSince: null,
    surplusConfirmed: true,
    confirmed: false,
  });
  // From then on it agrees with its badge and lowered surplus, so it is read
  // daily like every other page. The lowered surplus stays as a ceiling, but
  // the page repeats the evidence closing confirmed on day 609, so closing
  // does not re-read it.
  previous = lowering;
  for (const day of [610, 611]) {
    const run = await census(
      native,
      day,
      previous.terminal,
      previous.vins.length,
    );
    expect(run.models).toEqual(models);
    expect(run.requests).toBe(8 + models.length);
    expect(run.vins).toEqual(native.vins());
    expect(run.warnings.at(-1)).toBe(
      "Denton Read 12 of 12 model pages (daily 12); carried 0.",
    );
    expect(evidence(run.terminal)).toEqual({
      key: censusKey(model),
      count: 70,
      readDay: day,
      expected: 70,
      lowSince: null,
      surplusConfirmed: true,
      confirmed: false,
    });
    previous = run;
  }
}, 120_000);

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

test("Denton checkpoints charge every model page read daily and reject an uncharged page, an extra charge and a lost run day", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // Day 601 opening up to the first model page: nothing is carried after the
  // arrivals page, so model 0 is a charged read.
  const part = await Effect.runPromise(
    streamDentonInventory({
      previousAcceptedCount: null,
      previousCursor: cold.terminal,
      now: () => 601 * MODEL_CENSUS_DAY_MS,
      readPage: native.read,
      maxPages: 6,
      onBatch: () => Effect.die("unexpected staging"),
    }),
  );
  const cursor = part.cursor;
  if (cursor.phase !== "active") throw new Error("Expected a paused census");
  expect(cursor.requests).toBe(6);
  expect(cursor.opening).toHaveLength(6);
  const read = cursor.opening.at(-1);
  if (read?.kind !== "model") throw new Error("Expected a read model");
  expect(read.receipt.url).toBe(modelUrl(0));
  const previous = z
    .object({
      census: z.object({
        models: z.array(z.object({ key: z.string(), page: z.unknown() })),
      }),
    })
    .parse(cold.terminal)
    .census.models.find((m) => m.key === censusKey(0))?.page;
  if (previous === undefined) throw new Error("Expected model 0's census page");
  const resign = (value: object) => ({
    ...value,
    checksum: dentonHash({ ...value, checksum: undefined }),
  });
  expect(DentonCursor.parse(cursor, null).ok).toBe(true);
  for (const [tampered, message] of [
    // The accepted census page placed without a GET, as a carry would be:
    // under daily reads every model page is due, so it must be charged.
    [
      {
        ...cursor,
        opening: [...cursor.opening.slice(0, -1), previous],
        requests: cursor.requests - 1,
        bytes: cursor.bytes - read.receipt.bytes,
      },
      "accounting is inconsistent",
    ],
    [
      {
        ...cursor,
        requests: cursor.requests + 1,
        bytes: cursor.bytes + read.receipt.bytes,
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

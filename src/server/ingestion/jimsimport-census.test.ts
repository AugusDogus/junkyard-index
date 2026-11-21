import { expect, test } from "bun:test";
import { Effect } from "effect";
import { JimsimportProviderError } from "./jimsimport-client";
import { streamJimsimportInventory } from "./jimsimport-connector";
import {
  JIMSIMPORT_MINIMUM_BADGE_COVERAGE,
  JimsimportCursor,
} from "./jimsimport-cursor";
import type { JimsimportMenu, JimsimportPage } from "./jimsimport-parser";
import {
  jimsimportFixture,
  jimsimportOpeningFixture,
  nativeModelMenu,
  nativeModelPage,
} from "./jimsimport-test-fixtures";
import { jimsimportModels, jimsimportSnapshot } from "./jimsimport-transform";
import {
  JIMSIMPORT_CATALOG,
  JIMSIMPORT_ORIGIN,
  JIMSIMPORT_OWNER,
} from "./jimsimport-yard-metadata";
import {
  MODEL_CENSUS_DAY_MS,
  MODEL_CENSUS_REPLAY_MINIMUM,
  ModelCensus,
} from "./model-census";

const fixture = jimsimportOpeningFixture();
const MODELS = fixture.pages.length;

/** The saved Nov 15 native graph (33 makes, 334 models), editable between
 * runs. Each model page and make menu is served as rendered native HTML. */
function yard() {
  const menus: JimsimportMenu[] = fixture.menus.map((menu) => ({
    make: menu.make,
    models: menu.models.map((model) => ({ ...model })),
  }));
  const pages = new Map(fixture.pages.map((page) => [page.modelPath, page]));
  // Model paths whose page renders the native empty result while the menus
  // still count their donors.
  const broken = new Set<string>();
  // Model paths whose page renders only its first card while the menus still
  // count every donor.
  const cut = new Set<string>();
  const html = new Map<string, string>();
  const urls: string[] = [];
  const body = (url: string) => {
    if (url === JIMSIMPORT_OWNER) return jimsimportFixture("owner").body;
    if (url === JIMSIMPORT_CATALOG) return jimsimportFixture("catalog").body;
    const menu = menus.find((m) => JIMSIMPORT_ORIGIN + m.make.path === url);
    if (menu) return nativeModelMenu(menu);
    const path = url.slice(JIMSIMPORT_ORIGIN.length);
    const page = pages.get(path);
    if (!page) return undefined;
    if (!page.records.length || broken.has(path))
      return jimsimportFixture("empty").body;
    if (cut.has(path))
      return nativeModelPage({ ...page, records: page.records.slice(0, 1) });
    const cached = html.get(path) ?? nativeModelPage(page);
    html.set(path, cached);
    return cached;
  };
  return {
    urls,
    broken,
    cut,
    readPage: (url: string) => {
      urls.push(url);
      const value = body(url);
      return value === undefined
        ? Effect.fail(new JimsimportProviderError("test route", url))
        : Effect.succeed(value);
    },
    /** Replaces a model page and publishes its new badge count. */
    setPage(index: number, page: JimsimportPage, count: number) {
      const model = jimsimportModels(menus)[index]?.model;
      if (!model) throw new Error("Missing fixture model " + index);
      model.count = count;
      pages.set(page.modelPath, page);
      html.delete(page.modelPath);
    },
    page: (index: number) => {
      const page = pages.get(fixture.pages[index]?.modelPath ?? "");
      if (!page) throw new Error("Missing fixture page " + index);
      return page;
    },
    vins: () =>
      jimsimportSnapshot(
        menus,
        fixture.pages.map((p) => pages.get(p.modelPath) ?? p),
      )
        .vehicles.map((v) => v.vin)
        .sort(),
  };
}

/** One full run on `day`, seeded by the previous terminal cursor. */
async function census(
  native: ReturnType<typeof yard>,
  day: number,
  previousCursor: unknown,
) {
  const before = native.urls.length;
  let cursor: unknown = undefined;
  let phase = "";
  const vins: string[] = [];
  const warnings: string[] = [];
  while (phase !== "complete") {
    const result = await Effect.runPromise(
      streamJimsimportInventory({
        previousUniqueInventory: null,
        startCursor: cursor,
        // Only the first chunk may adopt a census; later chunks must not.
        previousCursor,
        now: () => day * MODEL_CENSUS_DAY_MS + 7 * 60 * 60 * 1000,
        readPage: native.readPage,
        onBatch: (batch) =>
          Effect.sync(() => {
            vins.push(...batch.map((v) => v.vin));
          }),
      }),
    );
    warnings.push(...result.warnings);
    phase = result.cursor.phase;
    cursor = JSON.parse(JSON.stringify(result.cursor));
  }
  const paths = fixture.pages.map((p) => JIMSIMPORT_ORIGIN + p.modelPath);
  const urls = native.urls.slice(before);
  const indexes = urls.flatMap((url) => {
    const index = paths.indexOf(url);
    return index < 0 ? [] : [index];
  });
  return {
    terminal: cursor,
    requests: urls.length,
    // Opening reads; a repeat of a model already read is its closing re-read.
    models: indexes.filter((index, i) => indexes.indexOf(index) === i),
    rereads: indexes.filter((index, i) => indexes.indexOf(index) !== i),
    vins: vins.sort(),
    warnings,
  };
}

/** Census key per fixture model, built exactly as the connector builds it
 * (parent make path and label, model path and label). */
const KEYS = jimsimportModels(fixture.menus).map(({ make, model }, index) => {
  if (model.path !== fixture.pages[index]?.modelPath)
    throw new Error("Fixture pages must follow published model order");
  return JSON.stringify([make.path, make.label, model.path, model.label]);
});

/** Published badge and saved cards per fixture model. */
const BADGES = jimsimportModels(fixture.menus).map(({ model }) => model.count);
const CARDS = fixture.pages.map((page) => page.records.length);

/** Fixture models whose saved cards differ from their published badge. */
const MISMATCHED = jimsimportModels(fixture.menus).flatMap(({ model }, i) =>
  fixture.pages[i]?.records.length === model.count ? [] : [i],
);
const mismatched = (models: readonly number[]) =>
  models.filter((i) => MISMATCHED.includes(i));

/** Fixture models listing fewer cards than their badge (the explicit-empty
 * SUBARU_PASS. at badge 1). */
const SHORT = CARDS.flatMap((cards, i) =>
  cards < (BADGES[i] ?? 0) ? [i] : [],
);

/** Fixture models listing more cards than their badge (placeholder or surplus
 * rows). A cold or gap read leaves their surplus unconfirmed, so the next
 * normal incremental run reads them again (reason "short"). */
const SURPLUS = CARDS.flatMap((cards, i) =>
  cards > (BADGES[i] ?? 0) ? [i] : [],
);

/** Census evidence per model stored by a terminal cursor. */
function evidenceOf(terminal: unknown) {
  const accepted = JimsimportCursor.parse(terminal);
  if (accepted.phase !== "complete" || !accepted.census)
    throw new Error("Expected a terminal census");
  return accepted.census.models;
}

/** Models a terminal cursor's census stores as confirmed short. */
const confirmed = (terminal: unknown) =>
  evidenceOf(terminal).flatMap((m, i) => (m.confirmed ? [i] : []));

/** Models a terminal cursor's census stores with an unconfirmed surplus. */
const unconfirmedSurplus = (terminal: unknown) =>
  evidenceOf(terminal).flatMap((m, i) => (m.surplusConfirmed ? [] : [i]));

/** Models in a day's sweep slice, by their stable key hash. */
const slice = (day: number) =>
  KEYS.flatMap((key, i) => (ModelCensus.slice(key) === day % 6 ? [i] : []));

test("Jim's Import cold start reads every model and publishes its census", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  expect(cold.models).toEqual(Array.from({ length: MODELS }, (_, i) => i));
  // Owner, makes, 33 menus, 334 models, closing makes, every read model
  // whose cards differ from its badge, and owner.
  expect(MISMATCHED).toHaveLength(23);
  expect(cold.rereads).toEqual(MISMATCHED);
  expect(cold.requests).toBe(2 + 33 + MODELS + 2 + MISMATCHED.length);
  expect(cold.vins).toEqual(native.vins());
  expect(cold.vins).toHaveLength(3649);
  expect(cold.warnings.some((w) => w.includes("every model page"))).toBe(false);
  expect(cold.warnings.at(-1)).toBe(
    `Jim's Import Read ${MODELS} of ${MODELS} model pages (cold ${MODELS}); carried 0.`,
  );
}, 120_000);

test("Jim's Import carries unread models, rotates the sweep and reads count changes", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // A cold run confirms no short page and no surplus.
  expect(SHORT).toHaveLength(1);
  expect(SURPLUS).toHaveLength(22);
  expect([...SHORT, ...SURPLUS].sort((a, b) => a - b)).toEqual(MISMATCHED);
  expect(confirmed(cold.terminal)).toEqual([]);
  expect(unconfirmedSurplus(cold.terminal)).toEqual(SURPLUS);
  // Day 601: only the sweep slice (key hash % 6 === 601 % 6) is read, plus
  // the short page and the surplus pages the cold run left unconfirmed. Those
  // read as short even inside the slice, and the first read (model 0) is a
  // sweep read.
  expect(slice(601).length).toBeGreaterThan(0);
  expect(slice(601)[0]).toBe(0);
  expect(slice(602).length).toBeGreaterThan(0);
  expect(SHORT.some((i) => slice(601).includes(i))).toBe(false);
  const read601 = [...new Set([...slice(601), ...MISMATCHED])].sort(
    (a, b) => a - b,
  );
  const sweep601 = slice(601).length - mismatched(slice(601)).length;
  expect(read601).toHaveLength(sweep601 + MISMATCHED.length);
  const next = await census(native, 601, cold.terminal);
  expect(next.models).toEqual(read601);
  // Every mismatched page was read, so closing re-reads each of them.
  expect(next.rereads).toEqual(MISMATCHED);
  expect(next.rereads).toEqual(expect.arrayContaining(SHORT));
  expect(next.requests).toBe(2 + 33 + read601.length + 2 + MISMATCHED.length);
  expect(next.warnings.at(-1)).toBe(
    `Jim's Import Read ${read601.length} of ${MODELS} model pages (sweep ${sweep601}, short ${MISMATCHED.length}); carried ${MODELS - read601.length}.`,
  );
  // This normal incremental run confirms them, so later days carry them.
  expect(confirmed(next.terminal)).toEqual(SHORT);
  expect(unconfirmedSurplus(next.terminal)).toEqual([]);
  // Carried donors are still published in full.
  expect(next.vins).toEqual(native.vins());

  // Day 602: a donor sells on a model outside today's slice; its badge
  // count changes, which forces a read and drops the donor.
  const published = new Set(native.vins());
  const changed = Array.from({ length: MODELS }, (_, i) => i).find(
    (i) =>
      !slice(602).includes(i) &&
      native.page(i).records.length >= 2 &&
      published.has(native.page(i).records[0]?.vin ?? ""),
  );
  if (changed === undefined) throw new Error("Fixture needs a sold donor");
  const before = native.page(changed);
  const sold = before.records[0];
  if (!sold?.vin) throw new Error("Fixture donor needs a VIN");
  native.setPage(
    changed,
    { ...before, records: before.records.slice(1) },
    before.records.length - 1,
  );
  const third = await census(native, 602, next.terminal);
  expect(third.models).toEqual([...slice(602), changed].sort((a, b) => a - b));
  expect(third.vins).toEqual(native.vins());
  expect(third.vins).not.toContain(sold.vin);
  expect(third.warnings.at(-1)).toBe(
    `Jim's Import Read ${slice(602).length + 1} of ${MODELS} model pages (count 1, sweep ${slice(602).length}); carried ${MODELS - slice(602).length - 1}.`,
  );
}, 240_000);

test("Jim's Import re-reads every model within six days, even across missed runs", async () => {
  const native = yard();
  let previous = (await census(native, 600, null)).terminal;
  const lastRead = new Map<number, number>();
  for (let i = 0; i < MODELS; i++) lastRead.set(i, 600);
  // The explicit-empty page below its badge, left unconfirmed by the cold run.
  const short = SHORT;
  expect(short).toHaveLength(1);
  expect(confirmed(previous)).toEqual([]);
  expect(unconfirmedSurplus(previous)).toEqual(SURPLUS);
  // Its slice is not day 604's, so day 604 reads it only as a short page. The
  // surplus pages the gap run left unconfirmed are read as short too, even
  // inside the slice, and the first read (model 1) is a sweep read.
  expect(short.some((i) => slice(604).includes(i))).toBe(false);
  expect(slice(604)[0]).toBe(1);
  const read604 = [...new Set([...slice(604), ...MISMATCHED])].sort(
    (a, b) => a - b,
  );
  const sweep604 = slice(604).length - mismatched(slice(604)).length;
  expect(read604).toHaveLength(sweep604 + MISMATCHED.length);
  // Skip day 601 and 602 entirely, then run daily.
  for (const day of [603, 604, 605, 606, 607, 608]) {
    expect(slice(day).length).toBeGreaterThan(0);
    const run = await census(native, day, previous);
    for (const model of run.models) lastRead.set(model, day);
    for (const read of lastRead.values()) expect(day - read).toBeLessThan(6);
    // Day 603 follows missed runs, so it reads every model, and as a gap run
    // it confirms no short page and no surplus. Day 604 is the first normal
    // incremental run: it re-reads the short and surplus pages, its closing
    // re-reads them again, and those confirmations are stored. Later days
    // carry them, one sixth read each.
    expect(run.models).toEqual(
      day === 603
        ? Array.from({ length: MODELS }, (_, i) => i)
        : day === 604
          ? read604
          : slice(day),
    );
    expect(run.warnings.at(-1)).toBe(
      day === 603
        ? `Jim's Import Read ${MODELS} of ${MODELS} model pages (gap ${MODELS}); carried 0.`
        : day === 604
          ? `Jim's Import Read ${read604.length} of ${MODELS} model pages (sweep ${sweep604}, short ${MISMATCHED.length}); carried ${MODELS - read604.length}.`
          : `Jim's Import Read ${slice(day).length} of ${MODELS} model pages (sweep ${slice(day).length}); carried ${MODELS - slice(day).length}.`,
    );
    if (day === 604) {
      expect(run.rereads).toEqual(MISMATCHED);
      expect(run.rereads).toEqual(expect.arrayContaining(short));
      expect(run.requests).toBe(
        2 + 33 + read604.length + 2 + MISMATCHED.length,
      );
    }
    expect(run.vins).toEqual(native.vins());
    expect(confirmed(run.terminal)).toEqual(day === 603 ? [] : short);
    expect(unconfirmedSurplus(run.terminal)).toEqual(
      day === 603 ? SURPLUS : [],
    );
    previous = run.terminal;
  }
}, 300_000);

test("Jim's Import treats an unreadable or incompatible previous cursor as a warned cold census", async () => {
  const native = yard();
  const fallback = await census(native, 600, {
    source: "jimsimport",
    junk: true,
  });
  expect(fallback.models).toHaveLength(MODELS);
  expect(fallback.warnings[0]).toContain("not a readable terminal census");
  expect(fallback.vins).toEqual(native.vins());

  const terminal = JimsimportCursor.parse(fallback.terminal);
  if (terminal.phase !== "complete" || !terminal.census)
    throw new Error("Expected a terminal census");
  const { checksum, ...state } = terminal;
  void checksum;
  const begin = (previousCursor: unknown) =>
    JimsimportCursor.begin(
      JimsimportCursor.initial(),
      601 * MODEL_CENSUS_DAY_MS,
      previousCursor,
    );
  // Another census contract is never reused.
  const foreign = begin(
    JimsimportCursor.checkpoint({
      ...state,
      census: { ...terminal.census, contract: "0".repeat(64) },
    }),
  );
  expect(foreign.warning).toContain("another parser or traversal contract");
  if (foreign.cursor.phase !== "owner") throw new Error("Wrong phase");
  expect(foreign.cursor.previous).toBeNull();
  // A pre-incremental terminal cursor stays readable and starts cold silently.
  const legacy = begin(
    JimsimportCursor.checkpoint({
      source: "jimsimport",
      version: 1,
      scope: "f".repeat(64),
      requests: 738,
      bytes: 50 * 1024 * 1024,
      phase: "complete",
    }),
  );
  expect(legacy.warning).toBeNull();
  if (legacy.cursor.phase !== "owner") throw new Error("Wrong phase");
  expect(legacy.cursor.previous).toBeNull();
  expect(legacy.cursor.day).toBe(601);
  // The compatible census is adopted.
  const adopted = begin(fallback.terminal);
  expect(adopted.warning).toBeNull();
  if (adopted.cursor.phase !== "owner") throw new Error("Wrong phase");
  expect(adopted.cursor.previous?.models).toHaveLength(MODELS);
}, 120_000);

test("Jim's Import fails a run whose read and carried cards fall short of today's badges", async () => {
  // A site fault renders empty model pages while the menus keep their counts.
  // Closing confirms the empty pages and the floor and previous-count guards
  // still pass with five sixths carried, so only badge coverage catches it.
  const native = yard();
  const cold = await census(native, 600, null);
  const day = [601, 602, 603, 604, 605].find((d) => slice(d).length > 0);
  if (day === undefined) throw new Error("Fixture needs a non-empty slice");
  for (const i of slice(day)) {
    const path = fixture.pages[i]?.modelPath;
    if (path) native.broken.add(path);
  }
  const before = native.urls.length;
  let published = 0;
  let cursor: unknown = undefined;
  await expect(
    (async () => {
      for (;;) {
        const result = await Effect.runPromise(
          streamJimsimportInventory({
            previousUniqueInventory: cold.vins.length,
            startCursor: cursor,
            previousCursor: cold.terminal,
            now: () => day * MODEL_CENSUS_DAY_MS,
            readPage: native.readPage,
            onBatch: (batch) =>
              Effect.sync(() => {
                published += batch.length;
              }),
            onYards: () =>
              Effect.sync(() => {
                published++;
              }),
          }),
        );
        if (result.cursor.phase === "complete") return;
        cursor = JSON.parse(JSON.stringify(result.cursor));
      }
    })(),
  ).rejects.toThrow(
    `below the ${JIMSIMPORT_MINIMUM_BADGE_COVERAGE * 100}% coverage floor`,
  );
  expect(published).toBe(0);
  // The run stops at the end of the opening: no closing re-reads.
  expect(native.urls.slice(before).at(-1)).toBe(
    JIMSIMPORT_ORIGIN + fixture.pages[slice(day).at(-1) ?? -1]?.modelPath,
  );
}, 120_000);

test("Jim's Import carries short pages its closing confirmed and re-reads unconfirmed ones", async () => {
  const native = yard();
  // Badges are not card counts here: only pages with fewer cards than their
  // badge (the explicit-empty SUBARU_PASS. at badge 1) are short.
  expect(SHORT).toHaveLength(1);
  const model = SHORT[0] ?? -1;
  // The cold run, the run confirming it and the run carrying it all fall on
  // days outside its sweep slice, so only the short rule reads it.
  const start = [600, 601, 602, 603, 604, 605].find(
    (d) => !slice(d + 1).includes(model) && !slice(d + 2).includes(model),
  );
  if (start === undefined)
    throw new Error("Fixture needs two slices without it");
  const cold = await census(native, start, null);
  // A cold run never confirms a short page, even after its closing re-read.
  expect(cold.rereads).toContain(model);
  expect(confirmed(cold.terminal)).toEqual([]);
  // Nor any surplus page.
  expect(unconfirmedSurplus(cold.terminal)).toEqual(SURPLUS);
  // The next normal incremental run reads it again as short, with every
  // surplus page the cold run left unconfirmed (short too, even inside the
  // slice); its closing re-reads them identically, and those confirmations
  // are stored. The slice's first read is a sweep read.
  const firstSweep = slice(start + 1)[0] ?? -1;
  expect(MISMATCHED).not.toContain(firstSweep);
  expect(MISMATCHED.every((i) => i > firstSweep)).toBe(true);
  const read = [...new Set([...slice(start + 1), ...MISMATCHED])].sort(
    (a, b) => a - b,
  );
  const sweep = slice(start + 1).length - mismatched(slice(start + 1)).length;
  expect(read).toHaveLength(sweep + MISMATCHED.length);
  const confirming = await census(native, start + 1, cold.terminal);
  expect(confirming.models).toEqual(read);
  expect(confirming.rereads).toContain(model);
  expect(confirming.rereads).toEqual(MISMATCHED);
  expect(confirming.requests).toBe(
    2 + 33 + read.length + 2 + MISMATCHED.length,
  );
  expect(confirming.warnings.at(-1)).toBe(
    `Jim's Import Read ${read.length} of ${MODELS} model pages (sweep ${sweep}, short ${MISMATCHED.length}); carried ${MODELS - read.length}.`,
  );
  expect(unconfirmedSurplus(confirming.terminal)).toEqual([]);
  const terminal = JimsimportCursor.parse(confirming.terminal);
  if (terminal.phase !== "complete" || !terminal.census)
    throw new Error("Expected a terminal census");
  expect(
    terminal.census.models.flatMap((m, i) => (m.confirmed ? [i] : [])),
  ).toEqual(SHORT);
  expect(terminal.census.models[model]?.readDay).toBe(start + 1);
  const day = start + 2;
  // Confirmed short evidence is carried outside its sweep slice.
  const carried = await census(native, day, confirming.terminal);
  expect(carried.models).toEqual(slice(day));
  expect(carried.rereads).not.toContain(model);
  expect(confirmed(carried.terminal)).toEqual(SHORT);
  expect(unconfirmedSurplus(carried.terminal)).toEqual([]);
  // The same evidence without its in-run confirmation is read again.
  const { checksum, ...state } = terminal;
  void checksum;
  const unconfirmed = JimsimportCursor.checkpoint({
    ...state,
    census: {
      ...terminal.census,
      models: terminal.census.models.map((m, i) =>
        i === model ? { ...m, confirmed: false } : m,
      ),
    },
  });
  const reread = await census(native, day, unconfirmed);
  expect(reread.models).toEqual([...slice(day), model].sort((a, b) => a - b));
  expect(reread.rereads).toContain(model);
  expect(reread.warnings.at(-1)).toContain("short 1");
  expect(reread.vins).toEqual(native.vins());
  expect(unconfirmedSurplus(reread.terminal)).toEqual([]);
  const next = JimsimportCursor.parse(reread.terminal);
  if (next.phase !== "complete" || !next.census)
    throw new Error("Expected a terminal census");
  expect(next.census.models[model]?.confirmed).toBe(true);
  expect(next.census.models[model]?.readDay).toBe(day);
}, 240_000);

test("Jim's Import fails an incremental run whose sweep slice lists one card per model", async () => {
  // A site fault renders only the first card of each model page in today's
  // sweep slice while the menus keep their counts. Closing would confirm the
  // short pages, and five sixths are carried, so only coverage catches it.
  const native = yard();
  const cold = await census(native, 600, null);
  // The lightest slice leaves the most cards: the hardest one to catch.
  const listed = (day: number) =>
    CARDS.map((cards, i) =>
      slice(day).includes(i) ? Math.min(cards, 1) : cards,
    );
  const covered = (day: number) =>
    listed(day).reduce(
      (sum, cards, i) => sum + Math.min(cards, BADGES[i] ?? 0),
      0,
    );
  const day = [601, 602, 603, 604, 605].reduce((best, d) =>
    covered(d) > covered(best) ? d : best,
  );
  expect(slice(day).length).toBeGreaterThan(0);
  // Healthy daily runs up to the faulty day, so it reads incrementally.
  let last = cold;
  for (let healthy = 601; healthy < day; healthy++)
    last = await census(native, healthy, last.terminal);
  for (const i of slice(day)) {
    const path = fixture.pages[i]?.modelPath;
    if (path) native.cut.add(path);
  }
  const before = native.urls.length;
  let published = 0;
  let cursor: unknown = undefined;
  await expect(
    (async () => {
      for (;;) {
        const result = await Effect.runPromise(
          streamJimsimportInventory({
            previousUniqueInventory: last.vins.length,
            startCursor: cursor,
            previousCursor: last.terminal,
            now: () => day * MODEL_CENSUS_DAY_MS,
            readPage: native.readPage,
            onBatch: (batch) =>
              Effect.sync(() => {
                published += batch.length;
              }),
            onYards: () =>
              Effect.sync(() => {
                published++;
              }),
          }),
        );
        if (result.cursor.phase === "complete") return;
        cursor = JSON.parse(JSON.stringify(result.cursor));
      }
    })(),
  ).rejects.toThrow(
    `promised by today's model counts, below the ${JIMSIMPORT_MINIMUM_BADGE_COVERAGE * 100}% coverage floor`,
  );
  expect(published).toBe(0);
  // The run stops at the end of the opening: no closing re-reads.
  expect(native.urls.slice(before).at(-1)).toBe(
    JIMSIMPORT_ORIGIN + fixture.pages[slice(day).at(-1) ?? -1]?.modelPath,
  );
  // Independently of badge accuracy, the replay floor alone rejects the same
  // pages against the last accepted census.
  const terminal = JimsimportCursor.parse(last.terminal);
  if (terminal.phase !== "complete" || !terminal.census)
    throw new Error("Expected a terminal census");
  expect(
    ModelCensus.coverage(
      "Jim's Import",
      {
        controls: KEYS.map((key, i) => ({ key, count: BADGES[i] ?? 0 })),
        pages: fixture.pages.map((page, i) =>
          slice(day).includes(i)
            ? { ...page, records: page.records.slice(0, 1) }
            : page,
        ),
        previous: terminal.census,
        day,
        cards: (page) => page.records.length,
      },
      0,
      (i) => fixture.pages[i]?.modelPath ?? "?",
    ),
  ).toContain(
    `below the ${Math.round(MODEL_CENSUS_REPLAY_MINIMUM * 1000) / 10}% coverage floor`,
  );
}, 240_000);

test("Jim's Import re-reads a surplus page that lost donors down to its badge", async () => {
  // Some model pages list more cards than their badge. One that loses real
  // donors down to exactly its badge passes the cards-versus-badge closing
  // comparison, so closing re-reads it against its sticky surplus. The lower
  // page is not taken as the new truth: it stays short and is read every run
  // until a normal incremental run reads it six days after the drop.
  const native = yard();
  const cold = await census(native, 600, null);
  const published = new Set(cold.vins);
  const lost = (i: number) =>
    native
      .page(i)
      .records.slice(0, (CARDS[i] ?? 0) - (BADGES[i] ?? 0))
      .flatMap((r) => (r.vin && published.has(r.vin) ? [r.vin] : []));
  const target = [601, 602, 603, 604]
    .flatMap((day) =>
      slice(day).map((model) => ({ day, model, lost: lost(model) })),
    )
    .find(
      ({ model, lost }) =>
        (BADGES[model] ?? 0) > 0 &&
        (CARDS[model] ?? 0) > (BADGES[model] ?? 0) &&
        lost.length > 0,
    );
  if (!target) throw new Error("Fixture needs a surplus page with donors");
  const { day, model } = target;
  const badge = BADGES[model] ?? 0;
  const before = native.page(model);
  const surplus = before.records.length;
  native.setPage(
    model,
    { ...before, records: before.records.slice(before.records.length - badge) },
    badge,
  );
  // The cold run left the short page and every surplus page (this one too)
  // unconfirmed, so this first incremental run reads them all (reason
  // "short", even inside the slice) and its closing confirms all but this
  // one, whose read fell below its surplus. The slice's first read is a
  // sweep read.
  expect(confirmed(cold.terminal)).toEqual([]);
  expect(unconfirmedSurplus(cold.terminal)).toEqual(SURPLUS);
  expect(SURPLUS).toContain(model);
  expect(SHORT.some((i) => slice(day).includes(i))).toBe(false);
  const firstSweep = slice(day)[0] ?? -1;
  expect(MISMATCHED.every((i) => i > firstSweep)).toBe(true);
  const read = [...new Set([...slice(day), ...MISMATCHED])].sort(
    (a, b) => a - b,
  );
  const sweep = slice(day).length - mismatched(slice(day)).length;
  expect(read).toHaveLength(sweep + MISMATCHED.length);
  const dropped = await census(native, day, cold.terminal);
  expect(dropped.models).toEqual(read);
  // The page now matches its badge but fell below its sticky surplus.
  expect(dropped.rereads).toContain(model);
  expect(dropped.rereads).toEqual(MISMATCHED);
  expect(dropped.rereads).toEqual(expect.arrayContaining(SHORT));
  expect(dropped.requests).toBe(2 + 33 + read.length + 2 + MISMATCHED.length);
  expect(dropped.warnings.at(-1)).toBe(
    `Jim's Import Read ${read.length} of ${MODELS} model pages (sweep ${sweep}, short ${MISMATCHED.length}); carried ${MODELS - read.length}.`,
  );
  expect(confirmed(dropped.terminal)).toEqual(SHORT);
  // A lower read never confirms the surplus it keeps.
  expect(unconfirmedSurplus(dropped.terminal)).toEqual([model]);
  expect(dropped.vins).toEqual(native.vins());
  for (const vin of target.lost) expect(dropped.vins).not.toContain(vin);
  const evidence = (terminal: unknown) => {
    const m = evidenceOf(terminal)[model];
    return {
      readDay: m?.readDay,
      expected: m?.expected,
      lowSince: m?.lowSince,
      surplusConfirmed: m?.surplusConfirmed,
      confirmed: m?.confirmed,
    };
  };
  // One re-read at the badge does not erase the surplus.
  expect(evidence(dropped.terminal)).toEqual({
    readDay: day,
    expected: surplus,
    lowSince: day,
    surplusConfirmed: false,
    confirmed: false,
  });

  // Daily normal incremental runs. The page is read every run (reason
  // "short") and re-read at closing until the sixth day after the drop lowers
  // its surplus to the badge; from then on it carries. The other models
  // follow the sweep, or are stale six days after their last read.
  const lastRead = new Map<number, number>();
  for (let i = 0; i < MODELS; i++) lastRead.set(i, 600);
  for (const i of dropped.models) lastRead.set(i, day);
  const summary = (reasons: readonly (string | null)[]) => {
    const counts = new Map<string, number>();
    for (const reason of reasons)
      if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    const listed = [...counts].map(([reason, n]) => `${reason} ${n}`);
    return `Jim's Import Read ${total} of ${MODELS} model pages (${listed.join(", ")}); carried ${MODELS - total}.`;
  };
  let previous = dropped.terminal;
  for (let today = day + 1; today <= day + 7; today++) {
    const reasons = Array.from({ length: MODELS }, (_, i) => {
      if (i === model && today <= day + 6) return "short";
      if (today - (lastRead.get(i) ?? 600) >= 6) return "stale";
      if (slice(today).includes(i)) return "sweep";
      return null;
    });
    const reads = reasons.flatMap((reason, i) => (reason ? [i] : []));
    const run = await census(native, today, previous);
    expect(run.models).toEqual(reads);
    expect(run.rereads).toEqual(mismatched(reads));
    expect(run.requests).toBe(
      2 + 33 + reads.length + 2 + mismatched(reads).length,
    );
    expect(run.warnings.at(-1)).toBe(summary(reasons));
    expect(run.vins).toEqual(native.vins());
    for (const vin of target.lost) expect(run.vins).not.toContain(vin);
    expect(confirmed(run.terminal)).toEqual(SHORT);
    // The kept surplus stays unconfirmed until the run that lowers it.
    expect(unconfirmedSurplus(run.terminal)).toEqual(
      today < day + 6 ? [model] : [],
    );
    if (today < day + 6) {
      expect(run.rereads).toContain(model);
      expect(evidence(run.terminal)).toEqual({
        readDay: today,
        expected: surplus,
        lowSince: day,
        surplusConfirmed: false,
        confirmed: false,
      });
    } else if (today === day + 6) {
      // lowSince + 6: the normal incremental run lowers the surplus, and
      // with none left the page is confirmed.
      expect(run.rereads).toContain(model);
      expect(evidence(run.terminal)).toEqual({
        readDay: today,
        expected: badge,
        lowSince: null,
        surplusConfirmed: true,
        confirmed: false,
      });
    } else {
      // The badge-sized page is now its own expectation and carries.
      expect(run.models).not.toContain(model);
      expect(evidence(run.terminal)).toEqual({
        readDay: day + 6,
        expected: badge,
        lowSince: null,
        surplusConfirmed: true,
        confirmed: false,
      });
    }
    for (const i of reads) lastRead.set(i, today);
    previous = run.terminal;
  }
}, 600_000);

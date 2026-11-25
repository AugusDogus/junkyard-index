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

const ALL = Array.from({ length: MODELS }, (_, i) => i);

/** One sixth of the models (`part` 0 to 5), by their stable key hash. Every
 * page is read every run; this only picks a spread-out set of pages for a
 * site fault, as one broken sweep slice used to be. */
const sixth = (part: number) =>
  KEYS.flatMap((key, i) => (ModelCensus.slice(key) === part ? [i] : []));

/** Read reasons of the first normal incremental run after a cold or gap
 * run: the short page and every surplus page it left unconfirmed are read as
 * short, every other page as a daily read. */
const AFTER_FULL = ALL.map((i) => (MISMATCHED.includes(i) ? "short" : "daily"));
/** Read reasons once every short page and surplus is confirmed. */
const DAILY = ALL.map(() => "daily");

/** The run warning for one read reason per model, in published order. */
function summary(reasons: readonly string[]) {
  const counts = new Map<string, number>();
  for (const reason of reasons)
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const listed = [...counts].map(([reason, n]) => `${reason} ${n}`);
  return `Jim's Import Read ${reasons.length} of ${MODELS} model pages (${listed.join(", ")}); carried 0.`;
}

/** A run that read every model page once with these reasons and re-read
 * `rereads` at closing, with request accounting of a full read: owner, make
 * directory, 33 menus, every model, closing make directory, re-reads, owner. */
function expectFullRead(
  run: Awaited<ReturnType<typeof census>>,
  reasons: readonly string[],
  rereads: readonly number[],
) {
  expect(run.models).toEqual(ALL);
  expect(run.rereads).toEqual([...rereads]);
  expect(run.requests).toBe(2 + 33 + MODELS + 2 + rereads.length);
  expect(run.warnings.at(-1)).toBe(summary(reasons));
}

/** Runs one chunked crawl that must fail before publishing anything, and
 * returns the native URLs it requested. */
async function rejected(
  native: ReturnType<typeof yard>,
  day: number,
  last: Awaited<ReturnType<typeof census>>,
  message: string,
) {
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
  ).rejects.toThrow(message);
  expect(published).toBe(0);
  return native.urls.slice(before);
}

/** Model page URLs in published order. */
const PATHS = fixture.pages.map((p) => JIMSIMPORT_ORIGIN + p.modelPath);

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

test("Jim's Import reads every model page on every incremental run and reads count changes", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // A cold run confirms no short page and no surplus.
  expect(SHORT).toHaveLength(1);
  expect(SURPLUS).toHaveLength(22);
  expect([...SHORT, ...SURPLUS].sort((a, b) => a - b)).toEqual(MISMATCHED);
  expect(confirmed(cold.terminal)).toEqual([]);
  expect(unconfirmedSurplus(cold.terminal)).toEqual(SURPLUS);
  // Day 601, a normal incremental run: every model page is read. The short
  // page and the surplus pages the cold run left unconfirmed read as short,
  // every other page as a daily read, and closing re-reads each page whose
  // cards differ from its badge.
  const next = await census(native, 601, cold.terminal);
  expectFullRead(next, AFTER_FULL, MISMATCHED);
  expect(next.rereads).toEqual(expect.arrayContaining(SHORT));
  // This normal incremental run confirms them.
  expect(confirmed(next.terminal)).toEqual(SHORT);
  expect(unconfirmedSurplus(next.terminal)).toEqual([]);
  expect(evidenceOf(next.terminal).every((m) => m.readDay === 601)).toBe(true);
  expect(next.vins).toEqual(native.vins());

  // Day 602: a donor sells on a model whose cards match its badge; its badge
  // count changes, so that page reads as a count change and drops the donor.
  // Every other page is still read daily.
  const published = new Set(native.vins());
  const changed = ALL.find(
    (i) =>
      !MISMATCHED.includes(i) &&
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
  expectFullRead(
    third,
    ALL.map((i) => (i === changed ? "count" : "daily")),
    MISMATCHED,
  );
  expect(third.vins).toEqual(native.vins());
  expect(third.vins).not.toContain(sold.vin);
  expect(confirmed(third.terminal)).toEqual(SHORT);
  expect(evidenceOf(third.terminal).every((m) => m.readDay === 602)).toBe(true);
}, 240_000);

test("Jim's Import reads a model whose donor was crushed and replaced under an unchanged badge", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const accepted = await census(native, 601, cold.terminal);
  // Day 602: on a model whose cards match its badge, one donor leaves and
  // another arrives. The menu badge, the model key and the card count stay
  // the same, so nothing in the menus marks the page as changed.
  const published = new Set(accepted.vins);
  const model = ALL.find(
    (i) =>
      !MISMATCHED.includes(i) &&
      !sixth(602 % 6).includes(i) &&
      published.has(native.page(i).records[0]?.vin ?? ""),
  );
  if (model === undefined) throw new Error("Fixture needs a swappable donor");
  const before = native.page(model);
  const gone = before.records[0];
  if (!gone?.vin || !gone.image) throw new Error("Fixture donor needs a VIN");
  const stock = "ZZ" + gone.stock;
  const arrived = {
    ...gone,
    id: stock,
    stock,
    vin: "1FTZZ99Z9ZZ000001",
    destinations: gone.destinations.map((d) => d.replace(gone.stock, stock)),
    image: gone.image.replaceAll(gone.stock, stock),
  };
  expect(published.has(arrived.vin)).toBe(false);
  native.setPage(
    model,
    { ...before, records: [arrived, ...before.records.slice(1)] },
    before.records.length,
  );
  const terminal = JimsimportCursor.parse(accepted.terminal);
  if (terminal.phase !== "complete" || !terminal.census)
    throw new Error("Expected a terminal census");
  // Badge-only reuse would have carried the old page, outside today's sweep
  // slice, for up to six days.
  const controls = KEYS.map((key, i) => ({ key, count: BADGES[i] ?? 0 }));
  const cards = (page: JimsimportPage) => page.records.length;
  expect(
    ModelCensus.plan(controls, terminal.census, 602, {
      cards,
      reuse: "unchanged-key",
    })[model]?.kind,
  ).toBe("carry");
  // Daily reads read it, publish the arrival and drop the crushed donor.
  const swapped = await census(native, 602, accepted.terminal);
  expectFullRead(swapped, DAILY, MISMATCHED);
  expect(swapped.vins).toEqual(native.vins());
  expect(swapped.vins).toContain(arrived.vin);
  expect(swapped.vins).not.toContain(gone.vin);
  expect(evidenceOf(swapped.terminal)[model]?.page.records[0]?.vin).toBe(
    arrived.vin,
  );
}, 240_000);

test("Jim's Import reads every model on every run, even across missed runs", async () => {
  const native = yard();
  const previous = (await census(native, 600, null)).terminal;
  expect(confirmed(previous)).toEqual([]);
  expect(unconfirmedSurplus(previous)).toEqual(SURPLUS);
  // Skip day 601 and 602 entirely, then run daily.
  let last = previous;
  for (const day of [603, 604, 605, 606]) {
    const run = await census(native, day, last);
    // Day 603 follows missed runs, so it reads every model as a gap run and
    // confirms no short page and no surplus. Day 604 is the first normal
    // incremental run: it reads the short and surplus pages as short, its
    // closing re-reads them, and those confirmations are stored. Later days
    // read every page daily; closing still re-reads each page whose cards
    // differ from its badge.
    expectFullRead(
      run,
      day === 603 ? ALL.map(() => "gap") : day === 604 ? AFTER_FULL : DAILY,
      MISMATCHED,
    );
    expect(run.vins).toEqual(native.vins());
    expect(evidenceOf(run.terminal).every((m) => m.readDay === day)).toBe(true);
    expect(confirmed(run.terminal)).toEqual(day === 603 ? [] : SHORT);
    expect(unconfirmedSurplus(run.terminal)).toEqual(
      day === 603 ? SURPLUS : [],
    );
    last = run.terminal;
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

/** Cards a run lists, each model capped at its badge, when the pages in
 * `faulty` list `fault(cards)` cards instead. */
const coveredWith = (
  faulty: readonly number[],
  fault: (cards: number) => number,
) =>
  CARDS.reduce(
    (sum, cards, i) =>
      sum + Math.min(faulty.includes(i) ? fault(cards) : cards, BADGES[i] ?? 0),
    0,
  );

/** The sixth of the models that leaves the most cards under `fault`: the
 * hardest one to catch. */
const hardestSixth = (fault: (cards: number) => number) => {
  const part = [0, 1, 2, 3, 4, 5].reduce((best, p) =>
    coveredWith(sixth(p), fault) > coveredWith(sixth(best), fault) ? p : best,
  );
  expect(sixth(part).length).toBeGreaterThan(0);
  return sixth(part);
};

test("Jim's Import fails a run whose read cards fall short of today's badges", async () => {
  // A site fault renders a sixth of the model pages empty while the menus
  // keep their counts. Every page is read and closing would confirm the
  // empty pages, so badge coverage must reject the run before closing.
  const native = yard();
  const cold = await census(native, 600, null);
  const broken = hardestSixth(() => 0);
  for (const i of broken) {
    const path = fixture.pages[i]?.modelPath;
    if (path) native.broken.add(path);
  }
  const urls = await rejected(
    native,
    601,
    cold,
    `below the ${JIMSIMPORT_MINIMUM_BADGE_COVERAGE * 100}% coverage floor`,
  );
  // The opening read every model page (owner, make directory, 33 menus and
  // every model) and the run stops at its end: no closing re-reads.
  expect(urls).toHaveLength(2 + 33 + MODELS);
  expect(urls.filter((url) => PATHS.includes(url))).toEqual(PATHS);
  expect(urls.at(-1)).toBe(PATHS.at(-1));
}, 120_000);

test("Jim's Import confirms short pages at closing and still reads them every run", async () => {
  const native = yard();
  // Badges are not card counts here: only pages with fewer cards than their
  // badge (the explicit-empty SUBARU_PASS. at badge 1) are short.
  expect(SHORT).toHaveLength(1);
  const model = SHORT[0] ?? -1;
  const cold = await census(native, 600, null);
  // A cold run never confirms a short page, even after its closing re-read.
  expect(cold.rereads).toContain(model);
  expect(confirmed(cold.terminal)).toEqual([]);
  // Nor any surplus page.
  expect(unconfirmedSurplus(cold.terminal)).toEqual(SURPLUS);
  // The next normal incremental run reads it again as short, with every
  // surplus page the cold run left unconfirmed; its closing re-reads them
  // identically, and those confirmations are stored.
  const confirming = await census(native, 601, cold.terminal);
  expectFullRead(confirming, AFTER_FULL, MISMATCHED);
  expect(confirming.rereads).toContain(model);
  expect(unconfirmedSurplus(confirming.terminal)).toEqual([]);
  const terminal = JimsimportCursor.parse(confirming.terminal);
  if (terminal.phase !== "complete" || !terminal.census)
    throw new Error("Expected a terminal census");
  expect(confirmed(confirming.terminal)).toEqual(SHORT);
  expect(terminal.census.models[model]?.readDay).toBe(601);
  const day = 602;
  // Confirmed short evidence is never carried: the page is read again as a
  // daily read, and closing re-reads it because it still lists fewer cards
  // than its badge.
  const daily = await census(native, day, confirming.terminal);
  expectFullRead(daily, DAILY, MISMATCHED);
  expect(daily.rereads).toContain(model);
  expect(confirmed(daily.terminal)).toEqual(SHORT);
  expect(unconfirmedSurplus(daily.terminal)).toEqual([]);
  expect(evidenceOf(daily.terminal)[model]?.readDay).toBe(day);
  // The same evidence without its in-run confirmation reads as short.
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
  expectFullRead(
    reread,
    ALL.map((i) => (i === model ? "short" : "daily")),
    MISMATCHED,
  );
  expect(reread.vins).toEqual(native.vins());
  expect(unconfirmedSurplus(reread.terminal)).toEqual([]);
  const next = JimsimportCursor.parse(reread.terminal);
  if (next.phase !== "complete" || !next.census)
    throw new Error("Expected a terminal census");
  expect(next.census.models[model]?.confirmed).toBe(true);
  expect(next.census.models[model]?.readDay).toBe(day);
}, 240_000);

test("Jim's Import fails an incremental run whose sixth of model pages lists one card each", async () => {
  // A site fault renders only the first card of each model page in a sixth of
  // the models while the menus keep their counts. Every page is read and
  // closing would confirm the short pages, so only coverage catches it.
  const native = yard();
  const cold = await census(native, 600, null);
  // The sixth that leaves the most cards: the hardest one to catch.
  const cut = hardestSixth((cards) => Math.min(cards, 1));
  // A healthy daily run first, so the faulty day reads incrementally against
  // a census that confirmed every short page and surplus.
  const last = await census(native, 601, cold.terminal);
  const day = 602;
  for (const i of cut) {
    const path = fixture.pages[i]?.modelPath;
    if (path) native.cut.add(path);
  }
  const urls = await rejected(
    native,
    day,
    last,
    `promised by today's model counts, below the ${JIMSIMPORT_MINIMUM_BADGE_COVERAGE * 100}% coverage floor`,
  );
  // The opening read every model page and the run stops at its end: no
  // closing re-reads.
  expect(urls).toHaveLength(2 + 33 + MODELS);
  expect(urls.filter((url) => PATHS.includes(url))).toEqual(PATHS);
  expect(urls.at(-1)).toBe(PATHS.at(-1));
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
          cut.includes(i)
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
  // page is not taken as the new truth: it stays short and is read as short
  // and re-read at closing every run until a normal incremental run reads it
  // six days after the drop.
  const native = yard();
  const cold = await census(native, 600, null);
  const published = new Set(cold.vins);
  const lost = (i: number) =>
    native
      .page(i)
      .records.slice(0, (CARDS[i] ?? 0) - (BADGES[i] ?? 0))
      .flatMap((r) => (r.vin && published.has(r.vin) ? [r.vin] : []));
  const model = SURPLUS.find((i) => (BADGES[i] ?? 0) > 0 && lost(i).length > 0);
  if (model === undefined)
    throw new Error("Fixture needs a surplus page with donors");
  const gone = lost(model);
  const day = 601;
  const badge = BADGES[model] ?? 0;
  const before = native.page(model);
  const surplus = before.records.length;
  native.setPage(
    model,
    { ...before, records: before.records.slice(before.records.length - badge) },
    badge,
  );
  // The cold run left the short page and every surplus page (this one too)
  // unconfirmed, so this first incremental run reads them as short and its
  // closing confirms all but this one, whose read fell below its surplus.
  expect(confirmed(cold.terminal)).toEqual([]);
  expect(unconfirmedSurplus(cold.terminal)).toEqual(SURPLUS);
  const dropped = await census(native, day, cold.terminal);
  // The page now matches its badge but fell below its sticky surplus, so
  // closing still re-reads it.
  expectFullRead(dropped, AFTER_FULL, MISMATCHED);
  expect(dropped.rereads).toContain(model);
  expect(dropped.rereads).toEqual(expect.arrayContaining(SHORT));
  expect(confirmed(dropped.terminal)).toEqual(SHORT);
  // A lower read never confirms the surplus it keeps.
  expect(unconfirmedSurplus(dropped.terminal)).toEqual([model]);
  expect(dropped.vins).toEqual(native.vins());
  for (const vin of gone) expect(dropped.vins).not.toContain(vin);
  const evidence = (terminal: unknown) => {
    const m = evidenceOf(terminal)[model];
    return {
      readDay: m?.readDay,
      expected: m?.expected,
      lowSince: m?.lowSince,
      ceiling: m?.ceiling,
      surplusConfirmed: m?.surplusConfirmed,
      confirmed: m?.confirmed,
    };
  };
  // One re-read at the badge does not erase the surplus.
  expect(evidence(dropped.terminal)).toEqual({
    readDay: day,
    expected: surplus,
    lowSince: day,
    ceiling: null,
    surplusConfirmed: false,
    confirmed: false,
  });

  // Daily normal incremental runs read every page. This one reads as short
  // and is re-read at closing until the sixth day after the drop lowers its
  // surplus to the badge. From then on it is a daily read, and closing keeps
  // re-reading it against the lowered surplus, kept as a ceiling for twelve
  // run days, so a one-off fault behind the old surplus still fails the run.
  let previous = dropped.terminal;
  for (let today = day + 1; today <= day + 7; today++) {
    const reasons = ALL.map((i) =>
      i === model && today <= day + 6 ? "short" : "daily",
    );
    const run = await census(native, today, previous);
    expectFullRead(run, reasons, MISMATCHED);
    expect(run.rereads).toContain(model);
    expect(run.vins).toEqual(native.vins());
    for (const vin of gone) expect(run.vins).not.toContain(vin);
    expect(confirmed(run.terminal)).toEqual(SHORT);
    // The kept surplus stays unconfirmed until the run that lowers it.
    expect(unconfirmedSurplus(run.terminal)).toEqual(
      today < day + 6 ? [model] : [],
    );
    expect(evidence(run.terminal)).toEqual(
      today < day + 6
        ? {
            readDay: today,
            expected: surplus,
            lowSince: day,
            ceiling: null,
            surplusConfirmed: false,
            confirmed: false,
          }
        : // lowSince + 6: the normal incremental run lowers the surplus, and
          // with none left the badge-sized page is its own expectation. The
          // old surplus stays as the ceiling closing re-reads it against.
          {
            readDay: today,
            expected: badge,
            lowSince: null,
            ceiling: surplus - badge,
            surplusConfirmed: true,
            confirmed: false,
          },
    );
    previous = run.terminal;
  }
}, 600_000);

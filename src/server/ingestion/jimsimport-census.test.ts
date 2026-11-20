import { expect, test } from "bun:test";
import { Effect } from "effect";
import { JimsimportProviderError } from "./jimsimport-client";
import { streamJimsimportInventory } from "./jimsimport-connector";
import { JimsimportCursor } from "./jimsimport-cursor";
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
import { MODEL_CENSUS_DAY_MS } from "./model-census";

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
    if (!page.records.length) return jimsimportFixture("empty").body;
    const cached = html.get(path) ?? nativeModelPage(page);
    html.set(path, cached);
    return cached;
  };
  return {
    urls,
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
  return {
    terminal: cursor,
    requests: urls.length,
    models: urls.flatMap((url) => {
      const index = paths.indexOf(url);
      return index < 0 ? [] : [index];
    }),
    vins: vins.sort(),
    warnings,
  };
}

const slice = (day: number) =>
  Array.from({ length: MODELS }, (_, i) => i).filter((i) => i % 6 === day % 6);

test("Jim's Import cold start reads every model and publishes its census", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  expect(cold.models).toEqual(Array.from({ length: MODELS }, (_, i) => i));
  // Owner, makes, 33 menus, 334 models, closing makes and owner.
  expect(cold.requests).toBe(2 + 33 + MODELS + 2);
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
  // Day 601: only the sweep slice (ordinal % 6 === 601 % 6) is read.
  const next = await census(native, 601, cold.terminal);
  expect(next.models).toEqual(slice(601));
  expect(next.requests).toBe(2 + 33 + slice(601).length + 2);
  // Carried donors are still published in full.
  expect(next.vins).toEqual(native.vins());

  // Day 602: a donor sells on a model outside today's slice; its badge
  // count changes, which forces a read and drops the donor.
  const published = new Set(native.vins());
  const changed = Array.from({ length: MODELS }, (_, i) => i).find(
    (i) =>
      i % 6 !== 602 % 6 &&
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
  // Skip day 601 and 602 entirely, then run daily.
  for (const day of [603, 604, 605, 606, 607, 608]) {
    const run = await census(native, day, previous);
    for (const model of run.models) lastRead.set(model, day);
    for (const read of lastRead.values()) expect(day - read).toBeLessThan(6);
    // A normal day reads one sixth; on day 606 the slices missed on days 601
    // and 602 reach the age ceiling alongside today's slice.
    expect(run.models).toEqual(
      day === 606
        ? [...slice(600), ...slice(601), ...slice(602)].sort((a, b) => a - b)
        : slice(day),
    );
    expect(run.vins).toEqual(native.vins());
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

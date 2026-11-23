import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamSix03InventoryWithRequestGate } from "./six03-connector";
import {
  Six03CensusSchema,
  Six03Cursor,
  six03Census,
  six03CensusKey,
  six03CensusPlan,
  type Six03Census,
  type Six03Cursor as Six03CursorValue,
  type Six03Progress,
} from "./six03-cursor";
import {
  parseSix03Catalog,
  parseSix03Contact,
  parseSix03Detail,
  type Six03Detail,
  type Six03Post,
} from "./six03-parser";
import { six03PendingPosts } from "./six03-snapshot";
import {
  six03FixtureDetail,
  six03IndependentOracle,
  six03NativeFixtures,
} from "./six03-test-fixtures";
import {
  SIX03_CATALOG,
  SIX03_CONTACT,
  SIX03_ORIGIN,
} from "./six03-yard-metadata";
import {
  MODEL_CENSUS_DAY_MS,
  MODEL_CENSUS_SWEEP_DAYS,
  ModelCensus,
} from "./model-census";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
// A run day on a sweep boundary, so day D + k sweeps the donors in slice k.
const D = 6 * Math.floor(ModelCensus.day(Date.parse("2026-11-01")) / 6);
const fixtures = six03NativeFixtures();
const catalog = parseSix03Catalog(fixtures.catalog);
const contact = parseSix03Contact(fixtures.contact);
const posts = six03PendingPosts(catalog);
const parsed = new Map<string, Six03Detail>();
const detail = (post: Six03Post): Six03Detail => {
  const cached = parsed.get(post[0]);
  if (cached) return cached;
  const value = parseSix03Detail(six03FixtureDetail(post[0]), post);
  parsed.set(post[0], value);
  return value;
};
const documents = new Map(
  fixtures.details.map(([path, html]) => [SIX03_ORIGIN + path, html]),
);
documents.set(SIX03_CATALOG, fixtures.catalog);
documents.set(SIX03_CONTACT, fixtures.contact);

function serve(
  transform: (url: string, html: string, ordinal: number) => string = (
    _url,
    html,
  ) => html,
) {
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const html = documents.get(url);
      if (!html) throw new Error("Unexpected native GET " + url);
      requests.push(url);
      return new Response(transform(url, html, requests.length), {
        headers: { "content-type": "text/html" },
      });
    },
    { preconnect: original.preconnect },
  );
  return requests;
}

/** Donors whose sweep slice falls on `day`, in roster order. */
const sweep = (day: number) =>
  posts.filter(
    (post) =>
      ModelCensus.slice(six03CensusKey(post)) === day % MODEL_CENSUS_SWEEP_DAYS,
  );

/** The checkpoint of a run on `day` before closing request `closing`: every
 * donor the plan reads is parsed from the saved native page, every other
 * donor is the previous census evidence. */
function closingAt(
  day: number,
  previous: Six03Census | null,
  closing = 0,
): Six03Progress {
  const decisions = six03CensusPlan({ catalog, previous, day });
  const details = decisions.map((decision, index) => {
    const post = posts[index];
    if (!post) throw new Error("Missing pending donor");
    return decision.kind === "carry" ? decision.evidence.page : detail(post);
  });
  const reads = decisions.filter((decision) => decision.kind === "read");
  return Six03Cursor.checkpoint({
    ...Six03Cursor.initial,
    phase: "closing",
    contact,
    catalog,
    details,
    closing,
    requests: reads.length + 2 + closing,
    day,
    previous,
  });
}
/** The census an accepted run on `day` stores. */
const accepted = (day: number, previous: Six03Census | null) =>
  six03Census(closingAt(day, previous));
const terminal = (census: Six03Census) => ({
  source: "six03" as const,
  version: 1 as const,
  phase: "complete" as const,
  census,
});
let coldCensus: Six03Census | undefined;
const cold = () => (coldCensus ??= accepted(D, null));

/** Callbacks made by runs, including runs that fail. */
const calls = { count: 0 };
/** One full run on `day`, seeded by `previousCursor` on its first chunk. */
async function run(day: number, previousCursor: unknown) {
  let cursor: Six03CursorValue = Six03Cursor.initial;
  const vehicles: string[] = [];
  const warnings: string[] = [];
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamSix03InventoryWithRequestGate(
        {
          startCursor: cursor,
          // Only the first chunk adopts a census; later chunks keep theirs.
          previousCursor,
          now: () => day * MODEL_CENSUS_DAY_MS + 7 * 60 * 60 * 1000,
          maxPages: 8,
          onBatch: (batch) =>
            Effect.sync(() => {
              calls.count++;
              vehicles.push(...batch.map((vehicle) => vehicle.vin));
            }),
          onYards: () =>
            Effect.sync(() => {
              calls.count++;
            }),
        },
        gate,
      ),
    );
    warnings.push(...result.warnings);
    cursor = Six03Cursor.parse(Six03Cursor.serialize(result.cursor));
  }
  return { cursor, vehicles: vehicles.sort(), warnings };
}
const oracleVins = () =>
  six03IndependentOracle()
    .map((vehicle) => vehicle.vin)
    .sort();

test("603 carries unchanged donors from the last accepted census and reads today's sweep slice and new or changed cards", async () => {
  const due = sweep(D + 1);
  expect(due.length).toBeGreaterThan(0);
  expect(due.length).toBeLessThan(posts.length / 3);
  // Two donors outside the D + 1 sweep, so their reads come from the change:
  // `arrived` was not listed by the last accepted run, and `retitled` was
  // listed under another card title, which its key binds.
  const quiet = posts.filter(
    (post) => !due.some((swept) => swept[0] === post[0]),
  );
  const [arrived, retitled] = [quiet[3], quiet[40]];
  if (!arrived || !retitled) throw new Error("Expected quiet donors");
  const previous = cold();
  const census: Six03Census = {
    ...previous,
    models: previous.models.flatMap((model) =>
      model.key === six03CensusKey(arrived)
        ? []
        : model.key === six03CensusKey(retitled)
          ? [
              {
                ...model,
                key: six03CensusKey([
                  retitled[0],
                  retitled[1],
                  retitled[2],
                  retitled[3] + " old",
                  retitled[4],
                ]),
              },
            ]
          : [model],
    ),
  };
  const changed = new Set([arrived[0], retitled[0]]);
  const reads = posts.filter(
    (post) => changed.has(post[0]) || due.includes(post),
  );
  const reasons = new Map<string, number>();
  for (const post of reads) {
    const reason = changed.has(post[0]) ? "new" : "sweep";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const requests = serve();
  calls.count = 0;
  const next = await run(D + 1, terminal(census));
  // Opening contact and catalog, the donors due today in roster order, then
  // the closing contact, catalog and the first and last donors read this run.
  expect(requests).toEqual([
    SIX03_CONTACT,
    SIX03_CATALOG,
    ...reads.map((post) => SIX03_ORIGIN + post[0]),
    SIX03_CONTACT,
    SIX03_CATALOG,
    SIX03_ORIGIN + reads[0]?.[0],
    SIX03_ORIGIN + reads.at(-1)?.[0],
  ]);
  // Carried donors are still published in full.
  expect(next.vehicles).toEqual(oracleVins());
  expect(calls.count).toBe(2);
  expect(next.warnings).toContain(
    `603 donor census: Read ${reads.length} of ${posts.length} model pages (${[
      ...reasons,
    ]
      .map(([reason, n]) => `${reason} ${n}`)
      .join(", ")}); carried ${posts.length - reads.length}.`,
  );
  if (next.cursor.phase !== "complete" || !next.cursor.census)
    throw new Error("Expected a terminal census");
  const read = new Set(reads.map((post) => six03CensusKey(post)));
  expect(next.cursor.census.day).toBe(D + 1);
  expect(next.cursor.census.models.map((model) => model.key)).toEqual(
    posts.map((post) => six03CensusKey(post)),
  );
  for (const model of next.cursor.census.models)
    expect(model.readDay).toBe(read.has(model.key) ? D + 1 : D);
}, 300_000);

test("603 reads every donor after a gap and re-reads every donor within six days of daily runs", () => {
  const previous = cold();
  // A missed, failed or rejected day: every donor is read again.
  const gap = six03CensusPlan({ catalog, previous, day: D + 2 });
  expect(
    gap.every(
      (decision) => decision.kind === "read" && decision.reason === "gap",
    ),
  ).toBe(true);
  expect(ModelCensus.summary(gap)).toBe(
    `Read ${posts.length} of ${posts.length} model pages (gap ${posts.length}); carried 0.`,
  );
  // Daily runs read one sixth of the donors and keep every donor's evidence
  // under six days old.
  let census = previous;
  for (let day = D + 1; day <= D + 2 * MODEL_CENSUS_SWEEP_DAYS; day++) {
    const decisions = six03CensusPlan({ catalog, previous: census, day });
    const reads = decisions.filter((decision) => decision.kind === "read");
    expect(reads.length).toBe(sweep(day).length);
    census = accepted(day, census);
    for (const model of census.models)
      expect(day - model.readDay).toBeLessThan(MODEL_CENSUS_SWEEP_DAYS);
  }
}, 120_000);

test("603 starts a silent cold census without a previous census and a warned one when it is unusable", () => {
  const now = (D + 1) * MODEL_CENSUS_DAY_MS;
  const begin = (previousCursor: unknown) =>
    Six03Cursor.begin(Six03Cursor.initial, now, previousCursor);
  for (const silent of [
    null,
    undefined,
    { source: "six03", version: 1, phase: "complete" },
  ]) {
    const begun = begin(silent);
    expect(begun.warning).toBeNull();
    expect(begun.cursor.previous).toBeNull();
    expect(begun.cursor.day).toBe(D + 1);
  }
  const census = cold();
  expect(begin(terminal(census)).cursor.previous).toEqual(census);
  expect(begin({ source: "six03", junk: true }).warning).toBe(
    "Previous 603 checkpoint is not a readable terminal census; reading every donor page.",
  );
  expect(
    begin(terminal({ ...census, contract: "another-contract" })).warning,
  ).toContain("another parser or traversal contract");
  expect(
    Six03Cursor.begin(
      Six03Cursor.initial,
      (D - 1) * MODEL_CENSUS_DAY_MS,
      terminal(census),
    ).warning,
  ).toContain("dated after this run");
  const [first, second, ...rest] = census.models;
  if (!first || !second) throw new Error("Expected census evidence");
  // A stored donor whose fields no longer match its projection, and a donor
  // page stored under another donor's card.
  for (const models of [
    [
      { ...first, page: { ...first.page, image: "https://x.test/a.jpg" } },
      second,
      ...rest,
    ],
    [{ ...first, page: second.page }, second, ...rest],
  ]) {
    const begun = begin(terminal({ ...census, models }));
    expect(begun.warning).toContain("reading every donor page");
    expect(begun.cursor.previous).toBeNull();
  }
}, 60_000);

test("603 checkpoints reject carried donors, skipped reads, accounting and census days that disagree with the plan", async () => {
  serve();
  // A cold census on the day before the first daily run whose sweep leaves
  // the first donor carried.
  const offset = [0, 1, 2, 3, 4, 5].find(
    (k) => !sweep(D + k + 1).some((post) => post[0] === posts[0]?.[0]),
  );
  if (offset === undefined) throw new Error("Expected a carrying day");
  const previous = offset === 0 ? cold() : accepted(D + offset, null);
  const day = D + offset + 1;
  const due = sweep(day);
  const firstRead = posts.findIndex((post) => post[0] === due[0]?.[0]);
  expect(firstRead).toBeGreaterThan(0);
  const opening = await Effect.runPromise(
    streamSix03InventoryWithRequestGate(
      {
        previousCursor: terminal(previous),
        now: () => day * MODEL_CENSUS_DAY_MS,
        maxPages: 3,
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  const state = opening.cursor;
  if (state.phase !== "details") throw new Error("Expected a donor checkpoint");
  expect(state.requests).toBe(3);
  const carried = posts[0];
  if (!carried) throw new Error("Expected a carried donor");
  // A valid native donor observation that differs from the stored evidence.
  const forged = parseSix03Detail(
    six03FixtureDetail(carried[0]).replace("</h1>", " Forged</h1>"),
    carried,
  );
  expect(() =>
    Six03Cursor.checkpoint({
      ...state,
      details: [forged, ...state.details.slice(1)],
    }),
  ).toThrow("carried donor differs");
  expect(() =>
    Six03Cursor.checkpoint({
      ...state,
      // Stops inside the carried prefix, so the next donor is not a read.
      details: state.details.slice(0, firstRead - 1),
      requests: 2,
    }),
  ).toThrow("not due for a read");
  expect(() =>
    Six03Cursor.checkpoint({ ...state, requests: state.requests + 1 }),
  ).toThrow("request accounting");
  // A run day before the previous census day.
  expect(() => Six03Cursor.checkpoint({ ...state, day: day - 2 })).toThrow(
    "previous census is inconsistent",
  );
  expect(() => Six03Cursor.checkpoint({ ...state, day: null })).toThrow(
    "previous census is inconsistent",
  );
}, 60_000);

test("603 rejects an incremental run whose swept donor or closing re-read changes, before any callback", async () => {
  const due = sweep(D + 1);
  const target = SIX03_ORIGIN + due[0]?.[0];
  // A swept donor page loses its native Unit Data region.
  calls.count = 0;
  serve((url, html) =>
    url === target ? html.replaceAll("vr-unit-data", "vr-unit-gone") : html,
  );
  await expect(run(D + 1, terminal(cold()))).rejects.toThrow();
  expect(calls.count).toBe(0);
  // Closing re-reads the first and last donors read this run, not the first
  // and last carried donors; a change on either fails the run.
  for (const [closing, donor] of [
    [2, due[0]],
    [3, due.at(-1)],
  ] as const) {
    const url = SIX03_ORIGIN + donor?.[0];
    const requests = serve((requested, html) =>
      requested === url ? html.replace("</h1>", " Changed</h1>") : html,
    );
    let callbacks = 0;
    await expect(
      Effect.runPromise(
        streamSix03InventoryWithRequestGate(
          {
            startCursor: closingAt(D + 1, cold(), closing),
            maxPages: 1,
            onBatch: () =>
              Effect.sync(() => {
                callbacks++;
              }),
          },
          gate,
        ),
      ),
    ).rejects.toThrow("first/last donor");
    expect(requests).toEqual([url]);
    expect(callbacks).toBe(0);
  }
}, 120_000);

test("603 census keys stay inside the census key cap for maximum-length, heavily escaped cards", () => {
  const census = cold();
  const [first, ...rest] = census.models;
  if (!first) throw new Error("Expected census evidence");
  // The longest card Six03PostSchema accepts, with every text field made of
  // characters JSON must escape.
  const quotes = '"'.repeat(500);
  const card: Six03Post = [first.page.path, quotes, "2026", quotes, quotes];
  const escaped = {
    ...census,
    models: [{ ...first, key: six03CensusKey(card) }, ...rest],
  };
  expect(Six03CensusSchema.safeParse(escaped).success).toBe(true);
  expect(() => Six03Cursor.serialize(terminal(escaped))).not.toThrow();
}, 60_000);

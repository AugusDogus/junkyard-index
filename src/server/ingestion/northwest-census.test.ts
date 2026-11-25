import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  streamNorthwestInventoryWithRequestGate,
  type NorthwestStreamResult,
} from "./northwest-connector";
import { NorthwestCursor } from "./northwest-cursor";
import {
  NORTHWEST_MAKES,
  NORTHWEST_ORIGIN,
  NORTHWEST_ROOT,
} from "./northwest-yard-metadata";
import { MODEL_CENSUS_DAY_MS } from "./model-census";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const MAKE = "/parts/ACURA";
const envelope = (content: string) =>
  `<!doctype html><html><head><script>var urgid = 'AK01'; var iisHomeUrl = 'northwestautoparts.com';</script></head><body>${content}<footer>Northwest Auto Parts 5700 Camelot Drive Anchorage, AK 99504 907-333-6531</footer></body></html>`;
const vin = (model: number, n: number) =>
  "1HGCM82633A" + String(model * 1000 + n).padStart(6, "0");
const donors = (model: number, n = 200) =>
  Array.from({ length: n }, (_, i) => vin(model, i + 1));

/** Twelve ACURA models with 200 donors each (above the 2,229 floor). Rows,
 * labels and badge overrides can be edited between runs. */
function yard() {
  const rows = new Map(Array.from({ length: 12 }, (_, i) => [i, donors(i)]));
  const labels = new Map<number, string>();
  const badges = new Map<number, number>();
  // Models whose page renders the native empty result while the menus still
  // count their donors.
  const broken = new Set<number>();
  const label = (i: number) => labels.get(i) ?? "M" + i;
  const urls: string[] = [];
  const directory = (
    controls: { path: string; label: string; count: number }[],
  ) =>
    envelope(
      controls
        .map(
          (c) =>
            `<a class="iis-center-block" href="${NORTHWEST_ORIGIN + c.path}">${c.label} <span class="badge">${c.count}</span></a>`,
        )
        .join(""),
    );
  const modelPage = (i: number) => {
    const leaf = label(i);
    return envelope(
      `<h1>Used ACURA ${leaf} Parts</h1>` +
        (broken.has(i)
          ? "<h3>No Results Found. Try Browsing Our Parts Or Search Again</h3>"
          : "") +
        (broken.has(i) ? [] : (rows.get(i) ?? []))
          .map((v, n) => {
            const stock = `ST${i}-${n}`;
            return `<div class="card card-price"><div class="car-details"><b>Stock:</b> ${stock}<br><b>Year:</b> 2010<br><b>Make/Model:</b> ACURA ${leaf}<br><b>Vin:</b> ${v}<br></div><a href="${NORTHWEST_ORIGIN}/parts/ACURA/M${i}/${stock}/2010">See Parts</a></div>`;
          })
          .join(""),
    );
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
      // The make menu agrees with its model menu, badge overrides included.
      const total = [...rows].reduce(
        (n, [i, list]) => n + (badges.get(i) ?? list.length),
        0,
      );
      const model = /\/parts\/ACURA\/M(\d+)\/$/.exec(url);
      const body =
        url === NORTHWEST_ROOT
          ? envelope(`<a href="${NORTHWEST_MAKES}">Parts</a>`)
          : url === NORTHWEST_MAKES
            ? directory([{ path: MAKE, label: "ACURA", count: total }])
            : url === NORTHWEST_ORIGIN + MAKE
              ? directory(
                  [...rows].map(([i, list]) => ({
                    path: `${MAKE}/M${i}/`,
                    label: label(i),
                    count: badges.get(i) ?? list.length,
                  })),
                )
              : model
                ? modelPage(Number(model[1]))
                : undefined;
      if (body === undefined) throw new Error("Unexpected request " + url);
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  return { rows, labels, badges, broken, urls };
}

/** One full run on `day`, seeded by the previous terminal cursor. */
async function census(
  native: ReturnType<typeof yard>,
  day: number,
  previousCursor: unknown,
) {
  const before = native.urls.length;
  let cursor: NorthwestCursor = NorthwestCursor.initial;
  const vins: string[] = [];
  const warnings: string[] = [];
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamNorthwestInventoryWithRequestGate(
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
    cursor = NorthwestCursor.parse(NorthwestCursor.serialize(result.cursor));
  }
  const models = modelReads(native, before);
  const terminal: unknown = JSON.parse(NorthwestCursor.serialize(cursor));
  return {
    terminal,
    requests: native.urls.length - before,
    models,
    vins: vins.sort(),
    warnings,
  };
}

const allVins = (native: ReturnType<typeof yard>) =>
  [...native.rows.values()].flat().sort();

/** The census key the connector builds for fixture model `i` under `label`. */
const censusKey = (i: number, label = "M" + i) =>
  JSON.stringify([MAKE, "ACURA", `${MAKE}/M${i}/`, label]);

const every = Array.from({ length: 12 }, (_, i) => i);

/** Read days of every model in a terminal census, in published order. */
const readDays = (terminal: unknown) => {
  const parsed = NorthwestCursor.parse(JSON.stringify(terminal));
  if (parsed.phase !== "complete" || !parsed.census)
    throw new Error("Expected a terminal census");
  return parsed.census.models.map((m) => m.readDay);
};

/** Expected run summary for read reasons listed in published model order. */
function summary(total: number, reasons: readonly string[]) {
  const counts = new Map<string, number>();
  for (const reason of reasons)
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const parts = [...counts].map(([reason, n]) => `${reason} ${n}`);
  return `Northwest Read ${reasons.length} of ${total} model pages${parts.length ? ` (${parts.join(", ")})` : ""}; carried ${total - reasons.length}.`;
}

test("Northwest cold start reads every model and publishes its census", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  expect(cold.models).toEqual(Array.from({ length: 12 }, (_, i) => i));
  // Root, makes, one menu, 12 models, closing root and makes.
  expect(cold.requests).toBe(17);
  expect(cold.vins).toEqual(allVins(native));
  expect(cold.warnings).not.toContain(
    expect.stringContaining("Previous Northwest"),
  );
  expect(cold.warnings.at(-1)).toBe(
    "Northwest Read 12 of 12 model pages (cold 12); carried 0.",
  );

  // An unreadable previous checkpoint is a warned cold census, not a failure.
  const junk = await census(native, 601, { source: "northwest", junk: true });
  expect(junk.models).toHaveLength(12);
  expect(junk.warnings[0]).toBe(
    "Previous Northwest checkpoint is not a readable terminal census; reading every model page.",
  );
  // A census written under another contract is a warned cold census too.
  const parsed = NorthwestCursor.parse(JSON.stringify(cold.terminal));
  if (parsed.phase !== "complete" || !parsed.census)
    throw new Error("Expected a terminal census");
  const foreign = await census(native, 601, {
    ...parsed,
    census: { ...parsed.census, contract: "another contract" },
  });
  expect(foreign.models).toHaveLength(12);
  expect(foreign.warnings[0]).toContain("another parser or traversal contract");
  // A pre-incremental terminal cursor is a silent cold start.
  const legacy = await census(native, 601, {
    source: "northwest",
    version: 1,
    phase: "complete",
  });
  expect(legacy.models).toHaveLength(12);
  expect(legacy.warnings[0]).toStartWith("Northwest ");
  expect(legacy.warnings.at(-1)).toBe(
    "Northwest Read 12 of 12 model pages (cold 12); carried 0.",
  );
}, 120_000);

test("Northwest reads every model on every incremental run and reads changes", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const parsed = NorthwestCursor.parse(JSON.stringify(cold.terminal));
  if (parsed.phase !== "complete" || !parsed.census)
    throw new Error("Expected a terminal census");
  expect(parsed.census.models.map((m) => m.key)).toEqual(
    every.map((i) => censusKey(i)),
  );
  // Day 601: no model changed, yet every model page is read (reason daily)
  // and nothing is carried, at the cost of a full read.
  const next = await census(native, 601, cold.terminal);
  expect(next.models).toEqual(every);
  expect(next.requests).toBe(cold.requests);
  expect(next.requests).toBe(17);
  expect(next.vins).toEqual(allVins(native));
  expect(next.warnings.at(-1)).toBe(
    summary(
      12,
      every.map(() => "daily"),
    ),
  );
  expect(next.warnings.at(-1)).toEndWith("; carried 0.");
  expect(readDays(next.terminal)).toEqual(every.map(() => 601));

  // Day 602: a sold donor changes model 4's badge, and model 5 is relabelled
  // at the same path and count, so its old evidence no longer binds. Count
  // and new name why those pages are read; every other page is read daily.
  native.rows.set(4, donors(4, 199));
  native.labels.set(5, "M5 SPORT");
  const reasons602 = every.map((i) =>
    i === 4 ? "count" : i === 5 ? "new" : "daily",
  );
  const changed = await census(native, 602, next.terminal);
  expect(changed.models).toEqual(every);
  expect(changed.requests).toBe(17);
  expect(changed.vins).toEqual(allVins(native));
  expect(changed.vins).not.toContain(vin(4, 200));
  expect(changed.warnings.at(-1)).toBe(summary(12, reasons602));
  expect(readDays(changed.terminal)).toEqual(every.map(() => 602));

  // Day 603: a newly published model is read as new, beside every other
  // model read daily.
  native.rows.set(12, donors(12, 10));
  const added = await census(native, 603, changed.terminal);
  expect(added.models).toEqual([...every, 12]);
  expect(added.requests).toBe(18);
  expect(added.vins).toEqual(allVins(native));
  expect(added.warnings.at(-1)).toBe(
    summary(13, [...every.map(() => "daily"), "new"]),
  );
}, 120_000);

test("Northwest reads a model whose donors changed under an unchanged badge", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  expect(cold.vins).toContain(vin(7, 200));
  // One donor is crushed and another placed under model 7: its key and badge
  // (200) stay the same, so only reading the page shows the swap.
  native.rows.set(7, [...donors(7, 199), vin(7, 999)]);
  const swapped = await census(native, 601, cold.terminal);
  expect(swapped.models).toEqual(every);
  expect(swapped.warnings.at(-1)).toBe(
    summary(
      12,
      every.map(() => "daily"),
    ),
  );
  expect(swapped.vins).toEqual(allVins(native));
  expect(swapped.vins).toContain(vin(7, 999));
  expect(swapped.vins).not.toContain(vin(7, 200));
  // The new census holds today's page for model 7, not the crushed donor.
  const parsed = NorthwestCursor.parse(JSON.stringify(swapped.terminal));
  if (parsed.phase !== "complete" || !parsed.census)
    throw new Error("Expected a terminal census");
  const model7 = parsed.census.models[7];
  expect(model7?.count).toBe(200);
  expect(model7?.readDay).toBe(601);
  expect(model7?.page.records.flatMap((r) => r.vins)).toContain(vin(7, 999));
  expect(model7?.page.records.flatMap((r) => r.vins)).not.toContain(
    vin(7, 200),
  );
}, 120_000);

test("Northwest reads every model on every run, even across missed runs", async () => {
  const native = yard();
  let previous = (await census(native, 600, null)).terminal;
  // Skip days 601 and 602, run 603 and 604, skip 605, then run 606 and 607.
  // The first run after any missed day reads every model as gap; every other
  // run reads every model as daily.
  const gapDays = new Set([603, 606]);
  for (const day of [603, 604, 606, 607]) {
    const run = await census(native, day, previous);
    expect(run.models).toEqual(every);
    expect(run.requests).toBe(17);
    expect(run.warnings.at(-1)).toBe(
      summary(
        12,
        every.map(() => (gapDays.has(day) ? "gap" : "daily")),
      ),
    );
    expect(readDays(run.terminal)).toEqual(every.map(() => day));
    expect(run.vins).toEqual(allVins(native));
    previous = run.terminal;
  }
}, 120_000);

test("Northwest checkpoints charge a GET for every model page on an incremental run", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const parsed = NorthwestCursor.parse(JSON.stringify(cold.terminal));
  if (parsed.phase !== "complete" || !parsed.census)
    throw new Error("Expected a terminal census");
  // Stop after the menu: no model page is carried in before the first read.
  const first = await Effect.runPromise(
    streamNorthwestInventoryWithRequestGate(
      {
        previousCursor: cold.terminal,
        now: () => 601 * MODEL_CENSUS_DAY_MS,
        maxPages: 3,
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  const cursor = first.cursor;
  if (cursor.phase !== "models") throw new Error("Expected the model phase");
  expect(cursor.pages).toHaveLength(0);
  expect(cursor.requests).toBe(3);
  // Filling model 0 from the last accepted census without a GET breaks
  // request accounting: every page must be read.
  const previousPage = parsed.census.models[0]?.page;
  if (!previousPage) throw new Error("Expected model 0 evidence");
  expect(() =>
    NorthwestCursor.checkpoint({ ...cursor, pages: [previousPage] }),
  ).toThrow("request accounting");
  // Claiming a GET that read no page breaks it too.
  expect(() => NorthwestCursor.checkpoint({ ...cursor, requests: 4 })).toThrow(
    "request accounting",
  );
  // A run day cannot be cleared once requests were made.
  expect(() =>
    NorthwestCursor.checkpoint({ ...cursor, day: null, previous: null }),
  ).toThrow("run day or previous model census");
}, 120_000);

test("Northwest starts a warned cold census when carried evidence no longer holds", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const parsed = NorthwestCursor.parse(JSON.stringify(cold.terminal));
  if (parsed.phase !== "complete" || !parsed.census)
    throw new Error("Expected a terminal census");
  const [first, second, ...rest] = parsed.census.models;
  const record = first?.page.records[0];
  if (!first || !second || !record) throw new Error("Expected model evidence");
  const warning =
    "Previous Northwest census evidence no longer matches its fingerprint or model context; reading every model page.";
  // Records changed under an unchanged fingerprint (for example a new
  // defaulted record field) would fail every run that carries model 0.
  const stale = {
    ...first,
    page: {
      ...first.page,
      records: [
        { ...record, inquiries: ["x"] },
        ...first.page.records.slice(1),
      ],
    },
  };
  const fingerprint = await census(native, 601, {
    ...parsed,
    census: { ...parsed.census, models: [stale, second, ...rest] },
  });
  expect(fingerprint.models).toEqual(Array.from({ length: 12 }, (_, i) => i));
  expect(fingerprint.warnings[0]).toBe(warning);
  expect(fingerprint.vins).toEqual(allVins(native));
  // A self-consistent page filed under another model's key is rejected too.
  const swapped = await census(native, 601, {
    ...parsed,
    census: {
      ...parsed.census,
      models: [
        { ...first, page: second.page },
        { ...second, page: first.page },
        ...rest,
      ],
    },
  });
  expect(swapped.models).toHaveLength(12);
  expect(swapped.warnings[0]).toBe(warning);
  expect(swapped.vins).toEqual(allVins(native));
}, 120_000);

test("Northwest confirms a model read with fewer cards than its badge at closing", async () => {
  const native = yard();
  // Model 3's badge promises one more donor than its page lists.
  native.badges.set(3, 201);
  const cold = await census(native, 600, null);
  // Model 3 is read once in the model phase and once more at closing.
  expect(cold.models).toEqual([...Array.from({ length: 12 }, (_, i) => i), 3]);
  expect(cold.requests).toBe(18);
  expect(cold.vins).toEqual(allVins(native));
  // A cold run confirms nothing, closing re-read or not.
  const coldCensus = NorthwestCursor.parse(JSON.stringify(cold.terminal));
  if (coldCensus.phase !== "complete" || !coldCensus.census)
    throw new Error("Expected a terminal census");
  expect(coldCensus.census.models.map((m) => m.confirmed)).toEqual(
    Array.from({ length: 12 }, () => false),
  );

  // The next incremental run reads every model, model 3 as short, re-reads
  // model 3 at closing and confirms it.
  const confirming = await census(native, 601, cold.terminal);
  expect(confirming.models).toEqual([...every, 3]);
  // Root, makes, one menu, 12 models, closing root, makes and model 3.
  expect(confirming.requests).toBe(18);
  expect(confirming.vins).toEqual(allVins(native));
  expect(confirming.warnings.at(-1)).toBe(
    summary(
      12,
      every.map((i) => (i === 3 ? "short" : "daily")),
    ),
  );
  const confirmed = NorthwestCursor.parse(JSON.stringify(confirming.terminal));
  if (confirmed.phase !== "complete" || !confirmed.census)
    throw new Error("Expected a terminal census");
  expect(confirmed.census.models.map((m) => m.confirmed)).toEqual(
    Array.from({ length: 12 }, (_, i) => i === 3),
  );

  // A confirmed short page is still read the next day (reason daily) and,
  // still below its badge, re-read at closing and confirmed again.
  const again = await census(native, 602, confirming.terminal);
  expect(again.models).toEqual([...every, 3]);
  expect(again.requests).toBe(18);
  expect(again.vins).toEqual(allVins(native));
  expect(again.warnings.at(-1)).toBe(
    summary(
      12,
      every.map(() => "daily"),
    ),
  );
  const reconfirmed = NorthwestCursor.parse(JSON.stringify(again.terminal));
  if (reconfirmed.phase !== "complete" || !reconfirmed.census)
    throw new Error("Expected a terminal census");
  expect(reconfirmed.census.models.map((m) => m.confirmed)).toEqual(
    Array.from({ length: 12 }, (_, i) => i === 3),
  );

  // A short page that does not repeat at closing is never accepted.
  const modelUrl = NORTHWEST_ORIGIN + MAKE + "/M3/";
  const nativeFetch = globalThis.fetch;
  let modelReads = 0;
  globalThis.fetch = Object.assign(
    (input: string | URL | Request, init?: RequestInit) => {
      if (input === modelUrl && modelReads++ === 1)
        native.rows.set(3, donors(3, 199));
      return nativeFetch(input, init);
    },
    { preconnect: originalFetch.preconnect },
  );
  let cursor: NorthwestCursor = NorthwestCursor.initial;
  let callbacks = 0;
  const run = async () => {
    for (;;) {
      const result = await Effect.runPromise(
        streamNorthwestInventoryWithRequestGate(
          {
            startCursor: cursor,
            previousCursor: null,
            now: () => 600 * MODEL_CENSUS_DAY_MS,
            maxPages: 8,
            onBatch: () => Effect.sync(() => void callbacks++),
            onYards: () => Effect.sync(() => void callbacks++),
          },
          gate,
        ),
      );
      if (result.status === "complete") return result;
      cursor = result.cursor;
    }
  };
  await expect(run()).rejects.toThrow("Closing Northwest model list M3");
  expect(modelReads).toBe(2);
  expect(callbacks).toBe(0);
  // The failed run keeps its last validated checkpoint at the closing re-read.
  expect(cursor.phase).toBe("closing");
}, 120_000);

test("Northwest marks only closing-confirmed short pages and re-reads unconfirmed ones", async () => {
  const native = yard();
  native.badges.set(3, 201);
  const cold = await census(native, 600, null);
  const parsed = NorthwestCursor.parse(JSON.stringify(cold.terminal));
  if (parsed.phase !== "complete" || !parsed.census)
    throw new Error("Expected a terminal census");
  // Closing re-read model 3, but a cold run confirms no short page.
  expect(parsed.census.models.map((m) => m.confirmed)).toEqual(
    Array.from({ length: 12 }, () => false),
  );
  // The next incremental run reads the unconfirmed page as short and confirms
  // it at closing; full pages are not short and are read as daily.
  const first = await census(native, 601, cold.terminal);
  expect(first.models).toEqual([...every, 3]);
  expect(first.vins).toEqual(allVins(native));
  expect(first.warnings.at(-1)).toBe(
    summary(
      12,
      every.map((i) => (i === 3 ? "short" : "daily")),
    ),
  );
  const confirmed = NorthwestCursor.parse(JSON.stringify(first.terminal));
  if (confirmed.phase !== "complete" || !confirmed.census)
    throw new Error("Expected a terminal census");
  expect(confirmed.census.models.map((m) => m.confirmed)).toEqual(
    Array.from({ length: 12 }, (_, i) => i === 3),
  );
  // Evidence that lost its confirmation is read as short (not merely daily)
  // and confirmed again at closing.
  const unconfirmed = await census(native, 602, {
    ...confirmed,
    census: {
      ...confirmed.census,
      models: confirmed.census.models.map((m) => ({ ...m, confirmed: false })),
    },
  });
  expect(unconfirmed.models).toEqual([...every, 3]);
  expect(unconfirmed.vins).toEqual(allVins(native));
  expect(unconfirmed.warnings.at(-1)).toBe(
    summary(
      12,
      every.map((i) => (i === 3 ? "short" : "daily")),
    ),
  );
}, 120_000);

/** Runs every chunk of one census from a fresh cursor, counting publish
 * callbacks, and returns the completed result or the run's failure. */
async function guardedRun(
  day: number,
  previousCursor: unknown,
  published: { callbacks: number },
) {
  let cursor: NorthwestCursor = NorthwestCursor.initial;
  for (;;) {
    const result: NorthwestStreamResult = await Effect.runPromise(
      streamNorthwestInventoryWithRequestGate(
        {
          startCursor: cursor,
          previousCursor,
          now: () => day * MODEL_CENSUS_DAY_MS,
          maxPages: 8,
          onBatch: () => Effect.sync(() => void published.callbacks++),
          onYards: () => Effect.sync(() => void published.callbacks++),
        },
        gate,
      ),
    );
    if (result.status === "complete") return result;
    cursor = result.cursor;
  }
}

/** Fixture model pages requested since `from`, in request order. */
const modelReads = (native: ReturnType<typeof yard>, from: number) =>
  native.urls
    .slice(from)
    .flatMap((url) => /\/parts\/ACURA\/M(\d+)\/$/.exec(url)?.[1] ?? [])
    .map(Number);

test("Northwest fails a run whose model cards fall short of today's model badges", async () => {
  // A site fault renders empty model pages for a sixth of the models while the
  // menus look normal. Every page is read, so only the floor stops the run.
  const native = yard();
  const cold = await census(native, 600, null);
  for (const model of [2, 7]) native.broken.add(model);
  const published = { callbacks: 0 };
  const shortfall =
    "list 2000 of 2400 cards promised by today's model counts, below the 95% coverage floor";
  const before = native.urls.length;
  await expect(guardedRun(601, cold.terminal, published)).rejects.toThrow(
    shortfall,
  );
  // Every model was read and both empty pages were re-read at closing.
  expect(modelReads(native, before)).toEqual([...every, 2, 7]);
  // The rejection holds on the next day's gap read and after an outage (the
  // last accepted run six days old), since the badge floor always applies.
  await expect(guardedRun(602, cold.terminal, published)).rejects.toThrow(
    shortfall,
  );
  await expect(guardedRun(606, cold.terminal, published)).rejects.toThrow(
    shortfall,
  );
  expect(published.callbacks).toBe(0);
}, 120_000);

test("Northwest fails an incremental run whose pages are cut to one card each", async () => {
  // Accurate badges already fail such a cut on the 95% badge floor and the 1%
  // unrecovered rule. Pages that list more cards than their badge (surplus
  // rows) hide it from both, so only the replay of last accepted cards sees it.
  const native = yard();
  const cut = [2, 7];
  for (const model of every) {
    native.rows.set(model, donors(model, 400));
    if (cut.includes(model)) native.badges.set(model, 2);
  }
  const cold = await census(native, 600, null);
  expect(cold.vins).toEqual(allVins(native));
  // A sixth of the pages list one card each while every menu keeps its counts.
  for (const model of cut) native.rows.set(model, donors(model, 1));
  const published = { callbacks: 0 };
  const replay =
    "list 4002 of 4800 cards that the last accepted census listed, less any drop in their counts, below the 97% coverage floor";
  const before = native.urls.length;
  await expect(guardedRun(601, cold.terminal, published)).rejects.toThrow(
    replay,
  );
  // Every model was read; the cut pages differ from their badges, so closing
  // re-read them too.
  expect(modelReads(native, before)).toEqual([...every, 2, 7]);
  // After the rejection, gap reads stay judged against the same census while
  // it is under six days old.
  await expect(guardedRun(602, cold.terminal, published)).rejects.toThrow(
    replay,
  );
  await expect(guardedRun(605, cold.terminal, published)).rejects.toThrow(
    replay,
  );
  expect(published.callbacks).toBe(0);
  // Six days on (an outage, or a real drop rejected that long) the run is
  // judged like a cold run, on the badge floor, so the yard is not blocked.
  const outage = await guardedRun(606, cold.terminal, published);
  expect(outage.status).toBe("complete");
  expect(published.callbacks).toBe(2);
  expect(outage.warnings.at(-1)).toBe(
    summary(
      12,
      every.map(() => "gap"),
    ),
  );
}, 120_000);

test("Northwest re-reads a surplus page that lost cards down to exactly its badge", async () => {
  const native = yard();
  // Model 3's healthy page lists ten surplus rows beyond its badge.
  native.badges.set(3, 190);
  const cold = await census(native, 600, null);
  const model3 = (terminal: unknown) => {
    const parsed = NorthwestCursor.parse(JSON.stringify(terminal));
    if (parsed.phase !== "complete" || !parsed.census)
      throw new Error("Expected a terminal census");
    return parsed.census.models[3];
  };
  // The cold read first saw the surplus, so it is stored unconfirmed.
  expect(model3(cold.terminal)).toEqual({
    key: censusKey(3),
    count: 190,
    readDay: 600,
    expected: 200,
    lowSince: null,
    lowCount: null,
    lowRise: null,
    ceiling: null,
    ceilingSince: null,
    recheck: false,
    surplusConfirmed: false,
    confirmed: false,
    page: expect.anything(),
  });
  // The first incremental run reads model 3 as short (its surplus is
  // unconfirmed), every other model as daily, and closing re-reads model 3
  // (200 cards against a 190 badge); that run confirms the surplus.
  const confirming = await census(native, 601, cold.terminal);
  expect(confirming.models).toEqual([...every, 3]);
  expect(confirming.vins).toEqual(allVins(native));
  expect(confirming.warnings.at(-1)).toBe(
    summary(
      12,
      every.map((i) => (i === 3 ? "short" : "daily")),
    ),
  );
  expect(model3(confirming.terminal)).toEqual({
    key: censusKey(3),
    count: 190,
    readDay: 601,
    expected: 200,
    lowSince: null,
    lowCount: null,
    lowRise: null,
    ceiling: null,
    ceilingSince: null,
    recheck: false,
    surplusConfirmed: true,
    confirmed: false,
    page: expect.anything(),
  });
  // Real donors leave model 3 until its page lists exactly its badge. Its
  // confirmed surplus makes it a daily read, not a short one.
  const day = 602;
  native.rows.set(3, donors(3, 190));
  const cut = await census(native, day, confirming.terminal);
  // Cards equal the badge but fall below the 200 the last census listed, so
  // closing re-reads the page.
  expect(cut.models).toEqual([...every, 3]);
  expect(cut.vins).toEqual(allVins(native));
  expect(cut.warnings.at(-1)).toBe(
    summary(
      12,
      every.map(() => "daily"),
    ),
  );
  // The surplus is sticky: the drop keeps the 200 expectation (still
  // confirmed) and opens a low window on the cut day instead of accepting 190
  // as the new truth.
  expect(model3(cut.terminal)).toEqual({
    key: censusKey(3),
    count: 190,
    readDay: day,
    expected: 200,
    lowSince: day,
    lowCount: 190,
    lowRise: 0,
    ceiling: null,
    ceilingSince: null,
    recheck: false,
    surplusConfirmed: true,
    confirmed: false,
    page: expect.anything(),
  });
  // While it lists fewer than 200, every following daily run reads it as
  // short and closing re-reads it. One lagging re-read cannot lower the
  // surplus; only a normal incremental run six run days after the low window
  // opened lowers it to what the page lists.
  let terminal = cut.terminal;
  for (let daily = day + 1; daily <= day + 6; daily++) {
    const run = await census(native, daily, terminal);
    expect(run.models).toEqual([...every, 3]);
    expect(run.vins).toEqual(allVins(native));
    expect(run.warnings.at(-1)).toBe(
      summary(
        12,
        every.map((i) => (i === 3 ? "short" : "daily")),
      ),
    );
    const lowered = daily - day >= 6;
    expect(model3(run.terminal)).toEqual({
      key: censusKey(3),
      count: 190,
      readDay: daily,
      expected: lowered ? 190 : 200,
      lowSince: lowered ? null : day,
      lowCount: lowered ? null : 190,
      lowRise: lowered ? null : 0,
      ceiling: lowered ? 10 : null,
      ceilingSince: lowered ? daily : null,
      recheck: false,
      surplusConfirmed: true,
      confirmed: false,
      page: expect.anything(),
    });
    terminal = run.terminal;
  }
  // Once lowered, the page is no longer short and is read as daily, but it
  // still lists fewer than its count plus the ceiling, so closing re-reads it.
  const after = await census(native, day + 7, terminal);
  expect(after.models).toEqual([...every, 3]);
  expect(after.vins).toEqual(allVins(native));
  expect(after.warnings.at(-1)).toBe(
    summary(
      12,
      every.map(() => "daily"),
    ),
  );
  expect(model3(after.terminal)).toEqual({
    key: censusKey(3),
    count: 190,
    readDay: day + 7,
    expected: 190,
    lowSince: null,
    lowCount: null,
    lowRise: null,
    // Lowered by time while the page still lists less: the old surplus stays
    // as a ceiling for closing re-reads.
    ceiling: 10,
    ceilingSince: day + 6,
    recheck: false,
    surplusConfirmed: true,
    confirmed: false,
    page: expect.anything(),
  });
}, 120_000);

import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamNorthwestInventoryWithRequestGate } from "./northwest-connector";
import { NorthwestCursor } from "./northwest-cursor";
import { northwestHash } from "./northwest-parser";
import {
  NORTHWEST_MAKES,
  NORTHWEST_ORIGIN,
  NORTHWEST_ROOT,
} from "./northwest-yard-metadata";
import { MODEL_CENSUS_DAY_MS, ModelCensus } from "./model-census";

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
      const total = [...rows.values()].reduce((n, l) => n + l.length, 0);
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
  const models = native.urls
    .slice(before)
    .flatMap((url) => /\/parts\/ACURA\/M(\d+)\/$/.exec(url)?.[1] ?? [])
    .map(Number);
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

/** Published models whose sweep slice falls on `day`, in published order. */
const swept = (native: ReturnType<typeof yard>, day: number) =>
  [...native.rows.keys()]
    .filter(
      (i) => ModelCensus.slice(censusKey(i, native.labels.get(i))) === day % 6,
    )
    .sort((a, b) => a - b);

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

test("Northwest carries unread models, rotates the sweep and reads changes", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  const parsed = NorthwestCursor.parse(JSON.stringify(cold.terminal));
  if (parsed.phase !== "complete" || !parsed.census)
    throw new Error("Expected a terminal census");
  expect(parsed.census.models.map((m) => m.key)).toEqual(
    Array.from({ length: 12 }, (_, i) => censusKey(i)),
  );
  // Day 601: only the sweep slice (slice(key) === 601 % 6) is read.
  const sweep601 = swept(native, 601);
  expect(sweep601.length).toBeGreaterThan(0);
  const next = await census(native, 601, cold.terminal);
  expect(next.models).toEqual(sweep601);
  expect(next.requests).toBe(5 + sweep601.length);
  // Carried donors are still published in full.
  expect(next.vins).toEqual(allVins(native));
  expect(next.warnings.at(-1)).toBe(
    summary(
      12,
      sweep601.map(() => "sweep"),
    ),
  );

  // Day 602: a sold donor changes model 4's badge, and model 5 is relabelled
  // at the same path and count, so its carried context no longer binds. Count
  // and new outrank the sweep, so both reasons hold whatever their slices.
  native.rows.set(4, donors(4, 199));
  native.labels.set(5, "M5 SPORT");
  const sweep602 = swept(native, 602);
  const reasons602 = [...native.rows.keys()].flatMap((i) =>
    i === 4
      ? [{ i, reason: "count" }]
      : i === 5
        ? [{ i, reason: "new" }]
        : sweep602.includes(i)
          ? [{ i, reason: "sweep" }]
          : [],
  );
  const changed = await census(native, 602, next.terminal);
  expect(changed.models).toEqual(reasons602.map(({ i }) => i));
  expect(changed.vins).toEqual(allVins(native));
  expect(changed.vins).not.toContain(vin(4, 200));
  expect(changed.warnings.at(-1)).toBe(
    summary(
      12,
      reasons602.map(({ reason }) => reason),
    ),
  );

  // Next run (within the six-day ceiling of the cold census): a newly
  // published model is read outside its sweep slice, and the sweep has
  // rotated to another non-empty slice.
  native.rows.set(12, donors(12, 10));
  const addedDay = [603, 604, 605].find(
    (day) =>
      ModelCensus.slice(censusKey(12)) !== day % 6 &&
      swept(native, day).length > 0,
  );
  if (addedDay === undefined)
    throw new Error("fixture needs a day off model 12's slice with a sweep");
  const sweepAdded = swept(native, addedDay);
  expect(sweepAdded).not.toEqual(sweep601);
  const added = await census(native, addedDay, changed.terminal);
  expect(added.models).toEqual([...sweepAdded, 12]);
  expect(added.vins).toEqual(allVins(native));
}, 120_000);

test("Northwest re-reads every model within six days, even across missed runs", async () => {
  const native = yard();
  let previous = (await census(native, 600, null)).terminal;
  const lastRead = new Map<number, number>();
  for (let i = 0; i < 12; i++) lastRead.set(i, 600);
  const perDay: number[][] = [];
  // Skip days 601 and 602 entirely, then run daily.
  const days = [603, 604, 605, 606, 607, 608, 609, 610, 611, 612];
  for (const day of days) {
    const run = await census(native, day, previous);
    for (const model of run.models) lastRead.set(model, day);
    for (const read of lastRead.values()) expect(day - read).toBeLessThan(6);
    expect(run.vins).toEqual(allVins(native));
    perDay.push(run.models);
    previous = run.terminal;
  }
  // Once the missed days are absorbed, each run reads exactly its sweep slice,
  // so six consecutive runs read every model exactly once.
  const steady = days.slice(-6);
  expect(perDay.slice(-6)).toEqual(steady.map((day) => swept(native, day)));
  expect(
    perDay
      .slice(-6)
      .flat()
      .sort((a, b) => a - b),
  ).toEqual(Array.from({ length: 12 }, (_, i) => i));
}, 120_000);

test("Northwest rejects a checkpoint whose carried page differs from its census", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // The first day whose sweep slice does not start at model 0; stop after the
  // menu so every model before the first read (including model 0) is carried.
  const day = [601, 602, 603, 604, 605].find(
    (candidate) => (swept(native, candidate)[0] ?? 12) > 0,
  );
  if (day === undefined)
    throw new Error("fixture needs a day whose first swept model is not M0");
  const firstRead = swept(native, day)[0] ?? 12;
  const first = await Effect.runPromise(
    streamNorthwestInventoryWithRequestGate(
      {
        previousCursor: cold.terminal,
        now: () => day * MODEL_CENSUS_DAY_MS,
        maxPages: 3,
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  const cursor = first.cursor;
  if (cursor.phase !== "models") throw new Error("Expected the model phase");
  expect(cursor.pages).toHaveLength(firstRead);
  expect(cursor.requests).toBe(3);
  const carried = cursor.pages[0];
  if (!carried) throw new Error("Expected a carried model page");
  const records = carried.records.slice(1);
  const tampered = {
    ...cursor,
    pages: [{ records, hash: northwestHash(records) }],
  };
  expect(() => NorthwestCursor.checkpoint(tampered)).toThrow(
    "carried model page differs from its census",
  );
  // Claiming the carried page cost a GET breaks request accounting.
  expect(() => NorthwestCursor.checkpoint({ ...cursor, requests: 4 })).toThrow(
    "request accounting",
  );
  // A run day cannot be cleared once requests were made.
  expect(() =>
    NorthwestCursor.checkpoint({ ...cursor, day: null, previous: null }),
  ).toThrow("run day or previous model census");
});

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

  // A carried short page was confirmed on the run that read it.
  const day = [601, 602, 603, 604, 605].find(
    (candidate) => !swept(native, candidate).includes(3),
  );
  if (day === undefined) throw new Error("fixture needs a day without M3");
  const carried = await census(native, day, cold.terminal);
  expect(carried.models).toEqual(swept(native, day));
  expect(carried.vins).toEqual(allVins(native));

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
  // Closing re-read model 3, so its short page is confirmed; full pages are not short.
  expect(parsed.census.models.map((m) => m.confirmed)).toEqual(
    Array.from({ length: 12 }, (_, i) => i === 3),
  );
  // Evidence that lost its confirmation is never carried: model 3 is read off
  // its sweep slice and confirmed again at closing.
  const day = [601, 602, 603, 604, 605].find(
    (candidate) => !swept(native, candidate).includes(3),
  );
  if (day === undefined) throw new Error("fixture needs a day without M3");
  const unconfirmed = await census(native, day, {
    ...parsed,
    census: {
      ...parsed.census,
      models: parsed.census.models.map((m) => ({ ...m, confirmed: false })),
    },
  });
  const reads = [...swept(native, day), 3].sort((a, b) => a - b);
  expect(unconfirmed.models).toEqual([...reads, 3]);
  expect(unconfirmed.vins).toEqual(allVins(native));
  expect(unconfirmed.warnings.at(-1)).toBe(
    summary(
      12,
      reads.map((i) => (i === 3 ? "short" : "sweep")),
    ),
  );
}, 120_000);

test("Northwest fails a run whose read and carried cards fall short of today's model badges", async () => {
  // A site fault renders empty model pages while the menus look normal. Only
  // today's sweep slice is read, so carried pages still hold the other cards.
  const native = yard();
  const cold = await census(native, 600, null);
  const day = [601, 602, 603, 604, 605].find(
    (candidate) => swept(native, candidate).length > 0,
  );
  if (day === undefined) throw new Error("fixture needs a non-empty slice");
  for (const model of swept(native, day)) native.broken.add(model);
  let cursor: NorthwestCursor = NorthwestCursor.initial;
  let callbacks = 0;
  const run = async () => {
    for (;;) {
      const result = await Effect.runPromise(
        streamNorthwestInventoryWithRequestGate(
          {
            startCursor: cursor,
            previousCursor: cold.terminal,
            now: () => day * MODEL_CENSUS_DAY_MS,
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
  await expect(run()).rejects.toThrow("coverage floor");
  expect(callbacks).toBe(0);
}, 120_000);

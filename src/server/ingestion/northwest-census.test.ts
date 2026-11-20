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

/** Twelve ACURA models with 200 donors each (above the 2,229 floor). Rows and
 * labels can be edited between runs. */
function yard() {
  const rows = new Map(Array.from({ length: 12 }, (_, i) => [i, donors(i)]));
  const labels = new Map<number, string>();
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
        (rows.get(i) ?? [])
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
                    count: list.length,
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
  return { rows, labels, urls };
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
  // Day 601: only the sweep slice (ordinal % 6 === 601 % 6) is read.
  const next = await census(native, 601, cold.terminal);
  expect(next.models).toEqual([1, 7]);
  expect(next.requests).toBe(7);
  // Carried donors are still published in full.
  expect(next.vins).toEqual(allVins(native));
  expect(next.warnings.at(-1)).toBe(
    "Northwest Read 2 of 12 model pages (sweep 2); carried 10.",
  );

  // Day 602: a sold donor changes model 4's badge, and model 5 is relabelled
  // at the same path and count, so its carried context no longer binds.
  native.rows.set(4, donors(4, 199));
  native.labels.set(5, "M5 SPORT");
  const changed = await census(native, 602, next.terminal);
  expect(changed.models).toEqual([2, 4, 5, 8]);
  expect(changed.vins).toEqual(allVins(native));
  expect(changed.vins).not.toContain(vin(4, 200));
  expect(changed.warnings.at(-1)).toBe(
    "Northwest Read 4 of 12 model pages (sweep 2, count 1, new 1); carried 8.",
  );

  // Day 603: a newly published model is read outside its sweep slice.
  native.rows.set(12, donors(12, 10));
  const added = await census(native, 603, changed.terminal);
  expect(added.models).toEqual([3, 9, 12]);
  expect(added.vins).toEqual(allVins(native));
}, 120_000);

test("Northwest re-reads every model within six days, even across missed runs", async () => {
  const native = yard();
  let previous = (await census(native, 600, null)).terminal;
  const lastRead = new Map<number, number>();
  for (let i = 0; i < 12; i++) lastRead.set(i, 600);
  const perDay: number[] = [];
  // Skip days 601 and 602 entirely, then run daily.
  for (const day of [603, 604, 605, 606, 607, 608, 609, 610, 611, 612]) {
    const run = await census(native, day, previous);
    for (const model of run.models) lastRead.set(model, day);
    for (const read of lastRead.values()) expect(day - read).toBeLessThan(6);
    expect(run.vins).toEqual(allVins(native));
    perDay.push(run.models.length);
    previous = run.terminal;
  }
  // Once the missed days are absorbed, each run reads one sixth of the models.
  expect(perDay.slice(-6)).toEqual([2, 2, 2, 2, 2, 2]);
}, 120_000);

test("Northwest rejects a checkpoint whose carried page differs from its census", async () => {
  const native = yard();
  const cold = await census(native, 600, null);
  // Day 601 reads models 1 and 7; stop after the menu so model 0 is carried.
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
  expect(cursor.pages).toHaveLength(1);
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

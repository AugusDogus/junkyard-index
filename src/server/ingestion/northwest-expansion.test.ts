import { afterEach, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import type { NorthwestStreamResult } from "./northwest-connector";
import { streamNorthwestInventoryWithRequestGate } from "./northwest-connector";
import { NorthwestCursor } from "./northwest-cursor";
import {
  northwestSnapshot,
  validateNorthwestSnapshot,
} from "./northwest-catalog";
import {
  parseNorthwestDirectory,
  parseNorthwestModel,
} from "./northwest-parser";
import {
  NORTHWEST_MAKES,
  NORTHWEST_ROOT,
  NORTHWEST_YARD,
} from "./northwest-yard-metadata";
import { IngestionSourceFlags } from "./ingestion-source-flags";
import { VehicleDestination } from "~/lib/vehicle-destination";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";

const saved = z
  .object({
    evidenceKind: z.literal("browserDOM-with-rawHTTP-witnesses"),
    models: z.array(
      z.object({
        url: z.string(),
        make: z.string(),
        model: z.string(),
        count: z.number(),
        sourceFile: z.string(),
        raw: z.string().nullable(),
        heading: z.string().nullable(),
        rows: z.array(
          z.object({
            html: z.string(),
            inquiryNativeLabel: z.string().nullable(),
            destinations: z.array(
              z.object({
                literal: z.string().nullable(),
                href: z.string(),
                text: z.string(),
              }),
            ),
          }),
        ),
      }),
    ),
    rawCaptures: z.array(z.object({ url: z.string(), raw: z.string() })),
    census: z.object({
      result: z.object({
        addressMatches: z.array(
          z.object({
            coordinates: z.object({ x: z.number(), y: z.number() }),
            matchedAddress: z.string(),
          }),
        ),
      }),
    }),
  })
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL(
            "./northwest-test-fixtures/qualified-census.json.gz",
            import.meta.url,
          ),
        ),
        { maxOutputLength: 32 * 1024 * 1024 },
      ).toString("utf8"),
    ),
  );
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const rawByUrl = new Map(saved.rawCaptures.map((c) => [c.url, c.raw]));
const directoryRaw = rawByUrl.get(NORTHWEST_MAKES);
if (!directoryRaw)
  throw new Error("Missing actual Northwest make-directory response");
const makes = parseNorthwestDirectory(directoryRaw, "makes");
// Browser observations retained original row HTML, native links and inquiry claims.
// Only the surrounding test document/card envelopes are reconstructed. They are
// not represented as raw HTTP evidence; separate real responses test that boundary.
const envelope = (content: string) =>
  `<!doctype html><html><head><script>var urgid = 'AK01'; var iisHomeUrl = 'northwestautoparts.com';</script></head><body>${content}<footer>Northwest Auto Parts 5700 Camelot Drive Anchorage, AK 99504 907-333-6531</footer></body></html>`;
const pages = new Map(rawByUrl);
for (const make of makes) {
  const url = "https://northwestautoparts.com" + make.path;
  if (!pages.has(url))
    pages.set(
      url,
      envelope(
        saved.models
          .filter((m) => new URL(m.url).pathname.startsWith(make.path + "/"))
          .map(
            (m) =>
              `<a class="iis-center-block" href="${escape(m.url)}">${escape(m.model)} <span class="badge">${m.count}</span></a>`,
          )
          .join(""),
      ),
    );
}
for (const model of saved.models) {
  pages.set(
    model.url,
    model.raw ??
      envelope(
        `<h1>${escape(model.heading ?? "")}</h1>` +
          (model.rows.length
            ? model.rows
                .map(
                  (row) =>
                    `<div class="card card-price"><div class="car-details">${row.html}</div>${row.destinations.map((d) => `<a href="${escape(d.literal ?? d.href)}">${escape(d.text)}</a>`).join("")}${row.inquiryNativeLabel === null ? "" : `<button data-vehicle="${escape(row.inquiryNativeLabel)}">Inquire</button>`}</div>`,
                )
                .join("")
            : "<h3>No Results Found. Try Browsing Our Parts Or Search Again</h3>"),
      ),
  );
}
function graph() {
  const menus = makes.map((make) => {
    const raw = pages.get("https://northwestautoparts.com" + make.path);
    if (!raw) throw new Error("Missing make");
    return { ...make, models: parseNorthwestDirectory(raw, "models", make) };
  });
  const nativePages = menus.flatMap((make) =>
    make.models.map((model) => {
      const raw = pages.get("https://northwestautoparts.com" + model.path);
      if (!raw) throw new Error("Missing model");
      return parseNorthwestModel(raw, make, model);
    }),
  );
  return { menus, nativePages };
}
afterEach(() => spyOn(globalThis, "fetch").mockRestore());

test("Northwest replays all 36 makes and 334 models through its real client and durable checkpoints", async () => {
  const requested: string[] = [];
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input),
          headers = new Headers(init?.headers);
        requested.push(url);
        expect(headers.get("User-Agent")).toBe("Mozilla/5.0");
        expect(headers.get("Accept")).toBe("text/html");
        expect(init?.redirect).toBe("manual");
        const body = pages.get(url);
        if (body === undefined)
          throw new Error("Uncaptured Northwest control: " + url);
        return new Response(body, {
          headers: { "Content-Type": "text/html; charset=UTF-8" },
        });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  let cursor: NorthwestCursor = NorthwestCursor.initial;
  let count = 0;
  let terminal: NorthwestStreamResult | undefined;
  for (let chunk = 0; chunk < 60; chunk++) {
    const result: NorthwestStreamResult = await Effect.runPromise(
      streamNorthwestInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages: 8,
          onBatch: (vehicles) =>
            Effect.sync(() => {
              count += vehicles.length;
              expect(
                vehicles.every(
                  (v) =>
                    v.stateAbbr === "AK" &&
                    v.lat === NORTHWEST_YARD.lat &&
                    v.lng === NORTHWEST_YARD.lng,
                ),
              ).toBe(true);
              const first = vehicles[0];
              if (first)
                expect(VehicleDestination.resolve(first).kind).toBe(
                  "inventory",
                );
            }),
          onYards: (yards) =>
            Effect.sync(() => {
              expect(yards).toEqual([NORTHWEST_YARD]);
            }),
        },
        (request) => request,
      ),
    );
    cursor = parseDurableSourceCursor(
      "northwest",
      serializeDurableSourceCursor(result.cursor),
    );
    if (result.status === "complete") {
      terminal = result;
      break;
    }
    expect(result.count).toBe(0);
  }
  expect(cursor.phase).toBe("complete");
  expect(count).toBe(6688);
  expect(terminal?.accounting).toEqual({
    recordsProcessed: 6934,
    recordsRejected: 246,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  expect(terminal?.warnings).toContain(
    "Northwest unrecovered advertised donors: 26 / 6934 observed (0.374964%). Limit 1%.",
  );
  expect(
    new Set(requested.filter((url) => saved.models.some((m) => m.url === url)))
      .size,
  ).toBe(334);
  // Cold census: root, makes, 36 menus and 334 models; closing root and makes.
  expect(requested.length).toBe(374);
  expect(IngestionSourceFlags.resolve({})).toContain("northwest");
  expect(saved.census.result.addressMatches[0]?.coordinates).toEqual({
    x: NORTHWEST_YARD.lng,
    y: NORTHWEST_YARD.lat,
  });
}, 120000);

test("Northwest reports each unrecovered count and fails above the owner's 1% limit", () => {
  const { menus, nativePages } = graph();
  const snapshot = northwestSnapshot(menus, nativePages);
  expect(snapshot.missingDonors).toBe(26);
  expect(() => validateNorthwestSnapshot(snapshot)).not.toThrow();
  expect(snapshot.warnings).toContain(
    "Northwest CHRYSLER / TOWN & COUNTRY: badge advertises 21, found 0, unrecovered 21.",
  );
  expect(snapshot.warnings).toContain(
    "Northwest CHEVROLET / CHEVROLET PASS/: badge advertises 1, found 0, unrecovered 1.",
  );
  expect(() =>
    validateNorthwestSnapshot({ ...snapshot, missingDonors: 69 }),
  ).not.toThrow();
  expect(() =>
    validateNorthwestSnapshot({ ...snapshot, missingDonors: 70 }),
  ).toThrow("limit 1%");
  const last = nativePages.at(-1);
  if (!last) throw new Error("Missing final model");
  expect(() => northwestSnapshot(menus, nativePages.slice(0, -1))).toThrow(
    "missing published model",
  );
  const mismatch = {
    ...last,
    records: last.records.map((r) => ({ ...r, vins: ["wrong"] })),
  };
  expect(() =>
    NorthwestCursor.checkpoint({
      ...NorthwestCursor.initial,
      phase: "closing",
      root: "0".repeat(64),
      makes: menus,
      pages: [...nativePages.slice(0, -1), mismatch],
      closing: 0,
      requests: 372,
      day: 600,
      previous: null,
    }),
  ).toThrow();
});

test("Northwest native raw witnesses reject new continuation, truncation and wrong ownership", () => {
  const model = saved.models.find((m) => m.url.endsWith("/ACURA/MDX/"));
  if (!model?.raw) throw new Error("Missing actual MDX response");
  const make = { path: "/parts/ACURA", label: "ACURA", count: 7 },
    control = { path: "/parts/ACURA/MDX/", label: "MDX", count: 2 };
  expect(parseNorthwestModel(model.raw, make, control).records).toHaveLength(2);
  for (const raw of [
    model.raw.replace(
      "</body>",
      '<a rel="next" href="?page=2">Next</a></body>',
    ),
    model.raw.slice(0, -200),
    model.raw.replaceAll("'AK01'", "'OTHER'"),
  ])
    expect(() => parseNorthwestModel(raw, make, control)).toThrow();
  expect(pages.has(NORTHWEST_ROOT)).toBe(true);
});

test("Northwest transport refusals return no advanced checkpoint or inventory", async () => {
  for (const status of [403, 429, 503]) {
    let requests = 0;
    let emitted = 0;
    const refusal = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async () => {
          requests++;
          return new Response("Access denied", {
            status,
            headers: { "Content-Type": "text/html" },
          });
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    const result = await Effect.runPromise(
      Effect.either(
        streamNorthwestInventoryWithRequestGate(
          {
            maxPages: 1,
            onBatch: (vehicles) =>
              Effect.sync(() => {
                emitted += vehicles.length;
              }),
          },
          (request) => request,
        ),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(requests).toBe(1);
    expect(emitted).toBe(0);
    refusal.mockRestore();
  }
});

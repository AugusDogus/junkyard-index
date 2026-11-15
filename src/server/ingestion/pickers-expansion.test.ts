import { afterEach, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  pickersRequestGate,
  streamPickersInventoryWithRequestGate,
} from "./pickers-connector";
import { PickersCursor } from "./pickers-cursor";
import { PickersCoverageCursor } from "./pickers-coverage-cursor";
import { streamPickersCoverageWithRequestGate } from "./pickers-coverage-connector";
import {
  PickersNativeRowSchema,
  parsePickersInventory,
  parsePickersSearch,
} from "./pickers-parser";
import { transformPickersRecord } from "./pickers-transform";
import { PICKERS_SITES } from "./pickers-yard-metadata";

const fixtureSchema = z.object({
  captures: z.array(
    z.object({
      url: z.string().url(),
      method: z.enum(["GET", "POST"]),
      requestBody: z.string().nullable(),
      status: z.number(),
      headers: z.record(z.string()),
      raw: z.string(),
      bytes: z.number(),
      stem: z.string(),
      phase: z.string().optional(),
    }),
  ),
  failure: z.object({ requests: z.number(), error: z.string() }),
  ford: z.object({ raw: z.string() }),
  census: z.object({ raw: z.string() }),
});
function fixture(city: "longview" | "reno") {
  return fixtureSchema.parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL(
            `./pickers-test-fixtures/${city}-census.json.gz`,
            import.meta.url,
          ),
        ),
        { maxOutputLength: 8 * 1024 * 1024 },
      ).toString("utf8"),
    ),
  );
}
afterEach(() => {
  spyOn(globalThis, "fetch").mockRestore();
});

for (const spec of [
  {
    city: "longview",
    code: "pickers-longview",
    makes: 39,
    native: 888,
    accepted: 843,
    rejected: 45,
    queries: 265,
    error: "recencyAnchor",
  },
  {
    city: "reno",
    code: "pickers-reno",
    makes: 34,
    native: 551,
    accepted: 545,
    rejected: 6,
    queries: 211,
    error: "duplicate native stock",
  },
] as const) {
  test(`Pickers ${spec.city} completes its full captured census through the production collector`, async () => {
    const saved = fixture(spec.city);
    const used = new Set<string>();
    let cursor: PickersCursor = PickersCursor.initial;
    let phase: PickersCursor["phase"] = "start";
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const closing =
            (phase === "native-closing" && init?.method === "POST") ||
            phase === "bookends";
          const capture = saved.captures.find(
            (c) =>
              c.url === String(input) &&
              c.method === (init?.method ?? "GET") &&
              c.requestBody === (init?.body ?? null) &&
              (closing ? c.phase === phase : c.phase === undefined),
          );
          if (!capture)
            throw new Error(
              "Uncaptured offline Pickers request: " + String(input),
            );
          expect(init?.redirect).toBe("manual");
          expect(Buffer.byteLength(capture.raw)).toBe(capture.bytes);
          used.add(capture.stem);
          return new Response(capture.raw, {
            status: capture.status,
            headers: capture.headers,
          });
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    let batches = 0,
      yards = 0;
    for (let i = 0; i < 30; i++) {
      phase = cursor.phase;
      const result = await Effect.runPromise(
        streamPickersInventoryWithRequestGate(
          {
            siteCode: spec.code,
            startCursor: cursor,
            maxPages: 32,
            onBatch: (vehicles) =>
              Effect.sync(() => {
                batches++;
                expect(vehicles).toHaveLength(spec.accepted);
                expect(
                  vehicles.every(
                    (vehicle) =>
                      vehicle.locationCode === spec.code &&
                      vehicle.detailsUrl ===
                        PICKERS_SITES[spec.code].yard.websiteUrl,
                  ),
                ).toBe(true);
              }),
            onYards: () =>
              Effect.sync(() => {
                yards++;
              }),
          },
          (request) => request,
        ),
      );
      cursor = PickersCursor.parse(PickersCursor.serialize(result.cursor));
      if (result.status === "complete") {
        expect(result.count).toBe(spec.accepted);
        expect(result.accounting?.recordsRejected).toBe(spec.rejected);
        break;
      }
      expect(result.count).toBe(0);
      expect(batches).toBe(0);
      expect(yards).toBe(0);
    }
    expect(batches).toBe(1);
    expect(yards).toBe(1);
    if (cursor.phase !== "complete")
      throw new Error("Expected completed captured census");
    expect(cursor.state.makes).toHaveLength(spec.makes);
    expect(cursor.state.native).toHaveLength(spec.native);
    expect(cursor.state.pairs).toHaveLength(spec.queries);
    expect(cursor.proof.processed).toBe(spec.native);
    expect(used.size).toBeGreaterThan(spec.queries + spec.makes * 2);
    const fleet = await Effect.runPromise(
      streamPickersCoverageWithRequestGate(
        {
          startCursor: {
            source: "pickers",
            version: 2,
            phase: "yard",
            siteCode: spec.code,
            cursor,
          },
          onBatch: () => Effect.void,
        },
        (request) => request,
      ),
    );
    const next = PickersCoverageCursor.parse(
      PickersCoverageCursor.serialize(fleet.cursor),
    );
    expect(fleet.status).toBe(spec.city === "reno" ? "complete" : "paused");
    if (spec.city === "longview")
      expect(next).toMatchObject({
        phase: "yard",
        siteCode: "pickers-reno",
        cursor: PickersCursor.initial,
      });
    await expect(
      Effect.runPromise(
        streamPickersInventoryWithRequestGate(
          {
            startCursor: cursor,
            siteCode: "pickers-texarkana",
            onBatch: () => Effect.void,
          },
          (request) => request,
        ),
      ),
    ).rejects.toThrow("different physical yard");
  }, 30_000);

  test(`Pickers ${spec.city} preserves its native column meanings and Census address point`, () => {
    const saved = fixture(spec.city),
      site = PICKERS_SITES[spec.code];
    const page = parsePickersInventory(saved.ford.raw, site);
    expect(page.makes).toHaveLength(spec.makes);
    expect(page.rows[0]?.make).toBe("FORD");
    if (spec.city === "longview") {
      expect(page.rows[0]?.color).toEqual(["literal", "WHITE"]);
      expect(page.rows[0]?.reference).toEqual(["literal", "V6, 4.0L"]);
      expect(() =>
        parsePickersInventory(saved.ford.raw.replace("</thead>", ""), site),
      ).toThrow("complete leading header");
    }
    expect(page.rows[0]?.image).toEqual([
      "literal",
      expect.stringContaining(site.photoDirectory),
    ]);
    expect(() => parsePickersInventory(saved.ford.raw)).toThrow(
      "address or phone",
    );
    const geocode = z
      .object({
        result: z.object({
          addressMatches: z
            .array(
              z.object({
                matchedAddress: z.string(),
                coordinates: z.object({ x: z.number(), y: z.number() }),
              }),
            )
            .length(1),
        }),
      })
      .parse(JSON.parse(saved.census.raw));
    expect(geocode.result.addressMatches[0]?.matchedAddress).toContain(
      site.yard.city.toUpperCase(),
    );
    expect(geocode.result.addressMatches[0]?.coordinates).toEqual({
      x: site.yard.lng,
      y: site.yard.lat,
    });
  });
}

test("Reno's conflicting Mustang stock is retained as a rejection", () => {
  const capture = fixture("reno").captures.find((capture) =>
    capture.requestBody?.includes('"model":"MUSTANG"'),
  );
  if (!capture) throw new Error("Missing original failure response");
  const body = z
    .object({
      matches: z.array(z.object({ stock: z.string(), vin: z.string() })),
    })
    .parse(JSON.parse(capture.raw));
  expect(
    body.matches.filter((r) => r.stock === "STK022321").map((r) => r.vin),
  ).toEqual(["5R07T201302", "6R07T201302"]);
  const records = parsePickersSearch(
    capture.raw,
    { make: "FORD", model: "MUSTANG" },
    PICKERS_SITES["pickers-reno"],
  );
  const conflict = records.find((record) => record.stock === "STK022321");
  expect(conflict?.identityConflicts).toHaveLength(2);
  const native = PickersNativeRowSchema.parse({
    ...parsePickersInventory(
      fixture("reno").ford.raw,
      PICKERS_SITES["pickers-reno"],
    ).rows.find((row) => row.stock === "STK022321"),
    makeIndex: 0,
    ordinal: 0,
  });
  if (!conflict) throw new Error("Missing conflict evidence");
  expect(
    transformPickersRecord(native, conflict, PICKERS_SITES["pickers-reno"]),
  ).toMatchObject({ status: "incomplete", vin: null });
});

test("the original Texarkana v1 terminal checkpoint remains resumable", () => {
  const wire = gunzipSync(
    readFileSync(
      new URL(
        "./pickers-test-fixtures/texarkana-v1-terminal.json.gz",
        import.meta.url,
      ),
    ),
  ).toString("utf8");
  const cursor = PickersCursor.parse(wire);
  if (cursor.phase !== "complete")
    throw new Error("Expected original terminal evidence");
  expect(cursor.state.siteCode).toBeUndefined();
  expect(cursor.proof.emitted).toBe(540);
  expect(cursor.proof.rejected).toBe(27);
  expect(PickersCursor.parse(PickersCursor.serialize(cursor))).toEqual(cursor);
});

test("the production Pickers gate retains its completed gap after failure", async () => {
  const started = performance.now();
  const result = await Effect.runPromise(
    pickersRequestGate(Effect.fail("parse failure")).pipe(Effect.either),
  );
  expect(result).toMatchObject({ _tag: "Left", left: "parse failure" });
  expect(performance.now() - started).toBeGreaterThanOrEqual(1_550);
});

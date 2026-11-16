import { expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import { z } from "zod";
import { streamHollanderstoresInventory } from "./hollanderstores-connector";
import {
  fetchHollanderstoresPage,
  hollanderstoresSeed,
} from "./hollanderstores-client";
import { HollanderstoresCursor } from "./hollanderstores-cursor";
import { loadHollanderstoresMakes } from "./hollanderstores-make-cache";
import { HOLLANDERSTORES_YARDS } from "./hollanderstores-yard-metadata";
import { resolveYardWebsite } from "~/lib/yard-website";

const root = `${import.meta.dir}/hollanderstores-test-fixtures/`;
import {
  hollanderstoresFixtureBody as body,
  hollanderstoresExpected as expected,
} from "./hollanderstores-test-fixtures";

test("independent HTTP response receipts, geocodes and audited make cache reconcile", () => {
  const manifest = z
    .object({
      responses: z.array(
        z.object({ file: z.string(), sha256: z.string(), bytes: z.number() }),
      ),
    })
    .parse(JSON.parse(readFileSync(root + "manifest.json", "utf8")));
  expect(manifest.responses).toHaveLength(10);
  for (const receipt of manifest.responses) {
    const raw = body(receipt.file);
    expect(Buffer.byteLength(raw)).toBe(receipt.bytes);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(receipt.sha256);
  }
  const audit = z
    .record(z.object({ Make: z.string() }))
    .parse(JSON.parse(body("vpic-audit.json.gz")));
  expect(Object.keys(audit)).toHaveLength(884);
  for (const [vin, result] of Object.entries(audit))
    expect(hollanderstoresSeed[vin]).toBe(result.Make);
  for (const yard of HOLLANDERSTORES_YARDS.slice(0, 5)) {
    const response = z
      .object({
        result: z.object({
          addressMatches: z
            .array(
              z.object({
                coordinates: z.object({ x: z.number(), y: z.number() }),
                addressComponents: z.object({
                  state: z.string(),
                  zip: z.string(),
                }),
              }),
            )
            .length(1),
        }),
      })
      .parse(
        JSON.parse(readFileSync(root + yard.code + "-geocode.json", "utf8")),
      );
    expect(response.result.addressMatches[0]?.coordinates).toEqual({
      x: yard.lng,
      y: yard.lat,
    });
    expect(response.result.addressMatches[0]?.addressComponents).toEqual({
      state: yard.state,
      zip: yard.postalCode,
    });
    expect(resolveYardWebsite({ ...yard, websiteUrl: null })).toEqual({
      kind: "yard",
      href: yard.websiteUrl,
    });
  }
});

test("all saved opening and closing bodies replay through production HTTP with cached makes and no network", async () => {
  let reads = 0,
    batches = 0,
    yards = 0;
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const yard =
          HOLLANDERSTORES_YARDS[reads % HOLLANDERSTORES_YARDS.length];
        if (!yard) throw new Error("Unexpected request");
        expect(String(input)).toBe(yard.websiteUrl + "VehicleDealerSearch");
        expect(init?.method).toBe("POST");
        expect(String(init?.body)).toBe("hdnChangeDisplay=card");
        const raw = body(
          yard.code +
            (reads++ >= HOLLANDERSTORES_YARDS.length ? "-closing" : "") +
            ".html.gz",
        );
        return new Response(raw, {
          headers: {
            "content-type": "text/html",
            "content-length": String(Buffer.byteLength(raw)),
          },
        });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    let cursor = HollanderstoresCursor.initial();
    while (cursor.phase !== "complete") {
      const result = await Effect.runPromise(
        streamHollanderstoresInventory({
          startCursor: cursor,
          maxPages: 8,
          readPage: (yard) =>
            fetchHollanderstoresPage(yard, (request) => request),
          decodeBatch: (vins) =>
            loadHollanderstoresMakes(
              vins,
              {
                read: (pending) =>
                  Effect.succeed(
                    pending.map((vin) => {
                      expect(expected.failedMakeVins).toContain(vin);
                      return null;
                    }),
                  ),
                write: () => Effect.die("Seeded VINs need no cache transport"),
              },
              (pending) =>
                Effect.sync(() =>
                  Object.fromEntries(
                    pending.map((vin) => {
                      expect(expected.failedMakeVins).toContain(vin);
                      return [vin, null];
                    }),
                  ),
                ),
            ),
          onBatch: (vehicles) =>
            Effect.sync(() => {
              batches++;
              expect(vehicles).toHaveLength(expected.count);
            }),
          onYards: (items) =>
            Effect.sync(() => {
              yards++;
              expect(items).toHaveLength(HOLLANDERSTORES_YARDS.length);
            }),
        }),
      );
      cursor = HollanderstoresCursor.fromWire(
        HollanderstoresCursor.serialize(result.cursor),
      );
      if (result.status === "paused")
        expect([result.count, batches, yards]).toEqual([0, 0, 0]);
    }
    expect([reads, batches, yards]).toEqual([
      2 * HOLLANDERSTORES_YARDS.length,
      1,
      1,
    ]);
  } finally {
    fetchSpy.mockRestore();
  }
}, 600_000);

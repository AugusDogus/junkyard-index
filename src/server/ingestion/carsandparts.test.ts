import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { z } from "zod";
import { CarsandpartsCursor } from "./carsandparts-cursor";
import { streamCarsandpartsInventory } from "./carsandparts-connector";
import {
  parseCarsandpartsInventory,
  parseCarsandpartsOwner,
} from "./carsandparts-parser";
import {
  CARSANDPARTS_CATALOG,
  CARSANDPARTS_COLLECTION,
  CARSANDPARTS_MINIMUM,
  CARSANDPARTS_YARD,
} from "./carsandparts-yard-metadata";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";
import { DURABLE_SOURCE_DEFINITIONS } from "./durable-source";
import { IngestionSourceFlags } from "./ingestion-source-flags";
import { shopifyYardSnapshot } from "./shopify-yard-snapshot";
import type { CanonicalVehicle } from "./types";

const root = new URL("./carsandparts-test-fixtures/", import.meta.url);
const bytes = (file: string) => gunzipSync(readFileSync(new URL(file, root)));
const body = (phase: string) =>
  bytes(`carsandparts-${phase}.gz`).toString("utf8");
const opening = () => parseCarsandpartsInventory(body("inventory-opening"));

test("the complete 77-donor collection preserves native production years rather than fitment ranges", () => {
  parseCarsandpartsOwner(body("owner-opening"));
  parseCarsandpartsOwner(body("owner-closing"));
  const rows = opening();
  expect(rows).toHaveLength(77);
  expect(rows).toEqual(parseCarsandpartsInventory(body("inventory-closing")));
  const publishedDestinations = [
    ...body("owner-opening").matchAll(
      /href="(\/products\/vehicle-[^"]+\?view=donor)"/g,
    ),
  ].map((match) => new URL(match[1] ?? "", CARSANDPARTS_COLLECTION).href);
  expect(publishedDestinations).toHaveLength(77);
  expect(publishedDestinations.sort()).toEqual(
    rows.map((row) => row.detailsUrl).sort(),
  );
  expect(rows.find((row) => row.stockNumber === "5004")).toMatchObject({
    year: "2019",
    make: "BMW",
    model: "530i xDrive",
  });
  const result = shopifyYardSnapshot(
    rows,
    CARSANDPARTS_YARD,
    "New Jersey",
    CARSANDPARTS_MINIMUM,
    77,
  );
  expect(result.accounting).toEqual({
    recordsProcessed: 77,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  });
  expect(result.vehicles).toHaveLength(77);
  expect(
    result.vehicles.every(
      (row) => row.locationCode === "lumberton" && row.stateAbbr === "NJ",
    ),
  ).toBe(true);
  // The collection's own arrival labels and the API's newest creation agree.
  expect(body("owner-opening")).toContain("Nov 2026");
  const dates = z
    .object({
      products: z.array(
        z.object({ created_at: z.string().datetime({ offset: true }) }),
      ),
    })
    .parse(JSON.parse(body("inventory-opening")));
  expect(
    Math.max(...dates.products.map((row) => Date.parse(row.created_at))),
  ).toBe(Date.parse("2026-11-16T17:21:11+04:00"));
});

test("bounded durable replay publishes only after four matching ownership and inventory responses", async () => {
  const emitted: CanonicalVehicle[] = [];
  const requests: string[] = [];
  let cursor = CarsandpartsCursor.initial();
  const captures = [
    "owner-opening",
    "inventory-opening",
    "inventory-closing",
    "owner-closing",
  ];
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamCarsandpartsInventory({
        previousUniqueInventory: 77,
        startCursor: cursor,
        maxPages: 1,
        readPage: (url) =>
          Effect.sync(() => {
            const capture = captures[requests.length];
            if (!capture) throw new Error("Unexpected provider request");
            requests.push(url);
            return body(capture);
          }),
        onBatch: (rows) =>
          Effect.sync(() => {
            emitted.push(...rows);
          }),
      }),
    );
    const wire = serializeDurableSourceCursor(result.cursor);
    cursor = CarsandpartsCursor.parse(
      parseDurableSourceCursor("carsandparts", wire),
    );
    if (result.status === "paused") expect(emitted).toHaveLength(0);
    else expect(result.count).toBe(77);
  }
  expect(requests).toEqual([
    CARSANDPARTS_COLLECTION,
    CARSANDPARTS_CATALOG,
    CARSANDPARTS_CATALOG,
    CARSANDPARTS_COLLECTION,
  ]);
  expect(emitted).toHaveLength(77);
  expect(DURABLE_SOURCE_DEFINITIONS.carsandparts.maxPagesPerChunk).toBe(4);
  expect(IngestionSourceFlags.resolve({})).toContain("carsandparts");
});

test("partial catalogs, foreign owners, invalid VINs, count drift and closing changes preserve prior inventory", async () => {
  expect(() =>
    parseCarsandpartsInventory(body("inventory-opening").slice(0, -1)),
  ).toThrow();
  expect(() =>
    parseCarsandpartsOwner(
      body("owner-opening").replaceAll("Lumberton", "Camden"),
    ),
  ).toThrow();
  const rows = opening();
  expect(() =>
    shopifyYardSnapshot(
      rows.map((row) => ({ ...row, vin: "1G1JD5SG0H4133271" })),
      CARSANDPARTS_YARD,
      "New Jersey",
      25,
      null,
    ),
  ).toThrow();
  expect(() =>
    shopifyYardSnapshot(
      rows.slice(0, 24),
      CARSANDPARTS_YARD,
      "New Jersey",
      25,
      null,
    ),
  ).toThrow();
  expect(() =>
    shopifyYardSnapshot(rows, CARSANDPARTS_YARD, "New Jersey", 25, 155),
  ).toThrow();
  const cursor = CarsandpartsCursor.checkpoint({ phase: "closing", rows });
  let emitted = false;
  await expect(
    Effect.runPromise(
      streamCarsandpartsInventory({
        previousUniqueInventory: 77,
        startCursor: cursor,
        readPage: () =>
          Effect.succeed(
            body("inventory-closing").replace(
              'stock_id_2"',
              'stock_id_changed"',
            ),
          ),
        onBatch: () =>
          Effect.sync(() => {
            emitted = true;
          }),
      }),
    ),
  ).rejects.toThrow();
  expect(emitted).toBe(false);
  const feed = z
    .object({ products: z.array(z.unknown()) })
    .parse(JSON.parse(body("inventory-opening")));
  expect(() =>
    parseCarsandpartsInventory(
      JSON.stringify({
        products: Array.from({ length: 250 }, () => feed.products[0]),
      }),
    ),
  ).toThrow();
});

test("named business markers establish the Lumberton address and exact saved bytes replay", () => {
  const locations = z
    .object({
      markers: z.array(
        z.object({
          title: z.string(),
          address: z.string(),
          latitude: z.number(),
          longitude: z.number(),
          phone: z.string(),
        }),
      ),
    })
    .parse(JSON.parse(readFileSync(new URL("locations.json", root), "utf8")));
  expect(locations.markers.map((row) => row.address)).toEqual([
    "1807 NJ-38, Lumberton Township, NJ 08048",
    "1807 NJ-38, Lumberton Township, NJ 08048",
  ]);
  expect(
    locations.markers.find((row) => row.title === "Cars And Parts Hub"),
  ).toMatchObject({
    latitude: CARSANDPARTS_YARD.lat,
    longitude: CARSANDPARTS_YARD.lng,
    phone: "+1640-202-3856",
  });
  const receipts = z
    .array(
      z.object({
        file: z.string(),
        bytes: z.number(),
        sha256: z.string(),
        status: z.literal(200),
      }),
    )
    .parse(JSON.parse(readFileSync(new URL("requests.json", root), "utf8")));
  expect(receipts).toHaveLength(4);
  for (const receipt of receipts) {
    const raw = bytes(receipt.file);
    expect(raw.byteLength).toBe(receipt.bytes);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(receipt.sha256);
  }
});

test("missing optional photos and publication timestamps preserve all donor identities", () => {
  const feed = z
    .object({ products: z.array(z.record(z.string(), z.unknown())) })
    .parse(JSON.parse(body("inventory-opening")));
  const rows = parseCarsandpartsInventory(
    JSON.stringify({
      products: feed.products.map(({ images, published_at, ...identity }) => {
        void images;
        void published_at;
        return identity;
      }),
    }),
  );
  expect(rows.map((row) => row.vin)).toEqual(opening().map((row) => row.vin));
  expect(rows.every((row) => row.imageUrl === null)).toBe(true);
});

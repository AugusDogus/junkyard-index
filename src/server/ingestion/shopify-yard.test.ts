import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Effect } from "effect";
import {
  parseHawaiipartsInventory,
  parseHawaiipartsOwner,
} from "./hawaiiparts-parser";
import {
  parseModernmuscleInventory,
  parseModernmuscleOwner,
} from "./modernmuscle-parser";
import {
  HAWAIIPARTS_CATALOG,
  HAWAIIPARTS_YARD,
} from "./hawaiiparts-yard-metadata";
import { MODERNMUSCLE_YARD } from "./modernmuscle-yard-metadata";
import { shopifyYardFixture } from "./shopify-yard-test-fixtures";
import { shopifyYardSnapshot } from "./shopify-yard-snapshot";
import { HawaiipartsCursor } from "./hawaiiparts-cursor";
import { ModernmuscleCursor } from "./modernmuscle-cursor";
import { streamHawaiipartsInventory } from "./hawaiiparts-connector";
import { streamModernmuscleInventory } from "./modernmuscle-connector";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
  DURABLE_SOURCE_DEFINITIONS,
} from "./durable-source";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";

const hawaii = () =>
  parseHawaiipartsInventory(shopifyYardFixture("hawaiiparts-yard-html"));
const muscle = () =>
  parseModernmuscleInventory(shopifyYardFixture("modernmuscle-feed"));
const snapshot = (rows = hawaii(), previous: number | null = null) =>
  shopifyYardSnapshot(rows, HAWAIIPARTS_YARD, "Hawaii", 35, previous);

describe("Shopify yard native census", () => {
  test("native UI and Census evidence ground feed controls, destinations and physical coordinates", () => {
    const ui = shopifyYardFixture("modernmuscle-page-html");
    expect(ui).toContain(
      "fetch('https://hooks.modernmusclesalvage.com/api/storefront/vehicles')",
    );
    expect(ui).toContain("vehicle.list_visible!==false");
    expect(ui).toContain(
      "/pages/shop-by-vehicle?stock=${encodeURIComponent(vehicle.stock_number)}",
    );
    const schema = z.object({
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
    });
    for (const [name, yard, address] of [
      [
        "hawaiiparts-geocode",
        HAWAIIPARTS_YARD,
        "91-222 OLAI ST, KAPOLEI, HI, 96707",
      ],
      [
        "modernmuscle-geocode",
        MODERNMUSCLE_YARD,
        "15980 32 MILE RD, RAY, MI, 48096",
      ],
    ] as const) {
      const raw: unknown = JSON.parse(shopifyYardFixture(name));
      const match = schema.parse(raw).result.addressMatches[0];
      expect(match?.matchedAddress).toBe(address);
      expect(match?.coordinates).toEqual({ x: yard.lng, y: yard.lat });
    }
  });
  test("LaChance donor JSON alone cannot meet the unchanged identity rejection guard", () => {
    const value: unknown = JSON.parse(shopifyYardFixture("lachance-products"));
    const data = z
      .object({
        products: z.array(z.object({ body_html: z.string().nullable() })),
      })
      .parse(value);
    const withVin = data.products.filter((p) =>
      /\b[A-HJ-NPR-Z0-9]{17}\b/.test(p.body_html ?? ""),
    );
    expect(data.products).toHaveLength(139);
    expect(withVin).toHaveLength(14);
    expect(
      (data.products.length - withVin.length) / data.products.length,
    ).toBeGreaterThan(SourceValidationPolicy.maximumRejectionRatio);
  });
  test("all 44 counted Hawaii cards have native identities, Kapolei ownership and exact anchors", () => {
    parseHawaiipartsOwner(shopifyYardFixture("hawaiiparts-home"));
    const result = snapshot();
    expect(result.accounting).toEqual({
      recordsProcessed: 44,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    });
    expect(result.vehicles).toHaveLength(44);
    expect(
      result.vehicles.every(
        (v) =>
          v.stateAbbr === "HI" &&
          v.locationCode === "kapolei" &&
          v.detailsUrl === HAWAIIPARTS_CATALOG + "#car-" + v.vin.toLowerCase(),
      ),
    ).toBe(true);
    expect(
      result.vehicles.find((v) => v.vin === "SALCP2BG1GH623503")?.make,
    ).toBe("Land Rover");
    // Three provider-relative photo paths are broken; no invented media destination.
    expect(
      result.vehicles.find((v) => v.vin === "JTHKD5BH6D2133318")?.imageUrl,
    ).toBeNull();
  });
  test("fails closed for missing cards, pagination, duplicate anchors, missing totals and incomplete HTML", () => {
    const html = shopifyYardFixture("hawaiiparts-yard-html");
    for (const changed of [
      html.replace('data-total="44"', 'data-total="45"'),
      html.replace('id="hpy-count"', 'id="missing"'),
      html.replace("</article>", ""),
      html.replace('id="car-kmhl34jj2sa121642"', 'id="car-4t1bf1fk8fu473924"'),
      html.slice(0, -30),
      html.replace(
        'id="hpy-grid">',
        'id="hpy-grid"><a rel="next" href="?page=2">Next</a>',
      ),
    ])
      expect(() => parseHawaiipartsInventory(changed)).toThrow();
  });
  test("does not assign Tampa cards or conflicting native headings to Kapolei", () => {
    const changed = parseHawaiipartsInventory(
      shopifyYardFixture("hawaiiparts-yard-html")
        .replace("📍 Kapolei, Oahu", "📍 Tampa, Florida")
        .replace(
          ">2025 Hyundai Sonata Hybrid</h2>",
          ">2024 Hyundai Sonata Hybrid</h2>",
        ),
    );
    expect(snapshot(changed).accounting.recordsRejected).toBe(2);
    expect(() =>
      parseHawaiipartsOwner(
        shopifyYardFixture("hawaiiparts-home").replaceAll(
          "91-222 Olai St",
          "other address",
        ),
      ),
    ).toThrow();
  });
  test("Modern Muscle reconciles all feed rows and keeps only public active donors", () => {
    parseModernmuscleOwner(shopifyYardFixture("modernmuscle-contact"));
    const result = shopifyYardSnapshot(
      muscle(),
      MODERNMUSCLE_YARD,
      "Michigan",
      300,
      null,
    );
    expect(result.vehicles).toHaveLength(349);
    expect(result.accounting).toEqual({
      recordsProcessed: 374,
      recordsExcluded: 17,
      recordsRejected: 8,
      duplicateVehicles: 0,
    });
    for (const row of muscle().filter((r) => r.status === "excluded"))
      expect(result.observedVins).not.toContain(row.vin);
    expect(result.vehicles.some((v) => v.stockNumber === "2247")).toBe(true); // New arrival, waiting to be dismantled.
    expect(
      result.vehicles.some((v) =>
        ["1057", "2016", "1092", "2055"].includes(v.stockNumber ?? ""),
      ),
    ).toBe(false);
    expect(result.observedVins).toContain("1GKEK63U84J172749");
    expect(
      result.vehicles.find((v) => v.stockNumber === "2247")?.detailsUrl,
    ).toBe("https://modernmusclesalvage.com/pages/shop-by-vehicle?stock=2247");
  });
  test("never retains feed business fields, even unknown nested payloads", () => {
    const raw = shopifyYardFixture("modernmuscle-feed").replace(
      '"stock_number": "2247"',
      '"vehicle_cost":12345,"profit":{"private":"must-drop"},"parts":[{"sold_revenue":100}],"stock_number":"2247"',
    );
    const rows = parseModernmuscleInventory(raw);
    const wire = ModernmuscleCursor.serialize(
      ModernmuscleCursor.checkpoint({ phase: "closing", rows }),
    );
    for (const field of ["vehicle_cost", "profit", "sold_revenue", "must-drop"])
      expect(wire).not.toContain(field);
    expect(rows).toEqual(muscle());
  });
  test("rejects feed count, stock uniqueness and status schema drift", () => {
    const raw = shopifyYardFixture("modernmuscle-feed");
    for (const changed of [
      raw.replace('"vehicle_count": 374', '"vehicle_count": 375'),
      raw.replace('"listed_vehicle_count": 357', '"listed_vehicle_count": 358'),
      raw.replace('"stock_number": "2265"', '"stock_number": "2247"'),
      raw.replace(
        '"availability_state": "new_arrival"',
        '"availability_state": "crushed"',
      ),
    ])
      expect(() => parseModernmuscleInventory(changed)).toThrow();
  });
  test("enforces 10% rejection, floors, duplicates and previous-count drift", () => {
    const rows = hawaii();
    expect(() =>
      snapshot(rows.map((r, i) => (i < 5 ? { ...r, vin: "" } : r))),
    ).toThrow("10% rejection");
    expect(
      snapshot(rows.map((r, i) => (i < 4 ? { ...r, vin: "" } : r))).vehicles,
    ).toHaveLength(40);
    expect(() => snapshot(rows.slice(0, 34))).toThrow("inventory floor");
    expect(() => snapshot(rows, 89)).toThrow("drift");
    expect(() => snapshot([...rows, ...rows.slice(0, 20)])).toThrow(
      "duplicate",
    );
    const first = rows[0];
    if (!first) throw new Error("Missing captured donor");
    expect(
      snapshot([...rows, { ...first, status: "excluded" }]).accounting
        .recordsRejected,
    ).toBe(2);
  });
  test("accepts native pre-1981 serials and observes valid identities on rejected metadata", () => {
    const rows = hawaii().map((r, i) =>
      i === 0
        ? { ...r, year: "1970", vin: "ABC12345" }
        : i === 1
          ? { ...r, model: "" }
          : r,
    );
    const result = snapshot(rows);
    expect(result.vehicles.some((v) => v.vin === "ABC12345")).toBe(true);
    expect(result.observedVins).toContain("KMHL34JJ2SA121642");
  });
});

describe("Shopify yard durable closure", () => {
  test("resumes each GET without emitting partial inventory", async () => {
    let cursor = HawaiipartsCursor.initial();
    const emitted: CanonicalVehicle[] = [];
    const urls: string[] = [];
    for (let i = 0; i < 4; i++) {
      const result = await Effect.runPromise(
        streamHawaiipartsInventory({
          previousUniqueInventory: null,
          startCursor: cursor,
          maxPages: 1,
          readPage: (url) => {
            urls.push(url);
            return Effect.succeed(
              shopifyYardFixture(
                url.endsWith("/")
                  ? "hawaiiparts-home"
                  : "hawaiiparts-yard-html",
              ),
            );
          },
          onBatch: (rows) =>
            Effect.sync(() => {
              emitted.push(...rows);
            }),
        }),
      );
      cursor = HawaiipartsCursor.fromWire(
        HawaiipartsCursor.serialize(result.cursor),
      );
      expect(result.status).toBe(i === 3 ? "complete" : "paused");
      expect(result.count).toBe(i === 3 ? 44 : 0);
      expect(result.observedVins.length).toBe(i === 3 ? 44 : 0);
      expect(emitted.length).toBe(i === 3 ? 44 : 0);
    }
    expect(urls).toHaveLength(4);
    const replay = await Effect.runPromise(
      streamHawaiipartsInventory({
        previousUniqueInventory: null,
        startCursor: cursor,
        readPage: () => {
          throw new Error("Complete cursor performed another GET");
        },
        onBatch: () => {
          throw new Error("Duplicate emission");
        },
      }),
    );
    expect(replay.count).toBe(0);
  });
  test("withholds inventory on closing census or owner drift", async () => {
    for (const drift of ["census", "owner"] as const) {
      let calls = 0;
      let emitted = false;
      const result = await Effect.runPromise(
        Effect.either(
          streamHawaiipartsInventory({
            previousUniqueInventory: null,
            readPage: (url) => {
              calls++;
              let raw = shopifyYardFixture(
                url.endsWith("/")
                  ? "hawaiiparts-home"
                  : "hawaiiparts-yard-html",
              );
              if (drift === "census" && calls === 3)
                raw = raw.replaceAll("Camry", "Corolla");
              if (drift === "owner" && calls === 4)
                raw = raw.replaceAll("91-222 Olai St", "changed");
              return Effect.succeed(raw);
            },
            onBatch: () =>
              Effect.sync(() => {
                emitted = true;
              }),
          }),
        ),
      );
      expect(result._tag).toBe("Left");
      expect(emitted).toBe(false);
    }
  });
  test("callbacks cannot change validated counts or static yard ownership", async () => {
    const result = await Effect.runPromise(
      streamHawaiipartsInventory({
        previousUniqueInventory: null,
        readPage: (url) =>
          Effect.succeed(
            shopifyYardFixture(
              url.endsWith("/") ? "hawaiiparts-home" : "hawaiiparts-yard-html",
            ),
          ),
        onBatch: (rows) =>
          Effect.sync(() => {
            rows.length = 0;
          }),
        onYards: (yards) =>
          Effect.sync(() => {
            const yard = yards[0];
            if (yard) yard.city = "changed";
          }),
      }),
    );
    expect(result.count).toBe(44);
    expect(HAWAIIPARTS_YARD.city).toBe("Kapolei");
  });
  test("replays Modern Muscle offline with no hidden or business data emission", async () => {
    const emitted: CanonicalVehicle[] = [];
    const result = await Effect.runPromise(
      streamModernmuscleInventory({
        previousUniqueInventory: 349,
        readPage: (url) =>
          Effect.succeed(
            shopifyYardFixture(
              url.endsWith("contact-information")
                ? "modernmuscle-contact"
                : "modernmuscle-feed",
            ),
          ),
        onBatch: (rows) =>
          Effect.sync(() => {
            emitted.push(...rows);
          }),
      }),
    );
    expect(result.status).toBe("complete");
    expect(emitted).toHaveLength(349);
  });
  test("registers bounded cursors, inventory floors and rejects corrupt, cross-source checkpoints", () => {
    for (const [source, cursor] of [
      ["hawaiiparts", HawaiipartsCursor.initial()],
      ["modernmuscle", ModernmuscleCursor.initial()],
    ] as const) {
      expect(DURABLE_SOURCE_DEFINITIONS[source].maxPagesPerChunk).toBe(4);
      const wire = serializeDurableSourceCursor(cursor);
      expect(parseDurableSourceCursor(source, wire)).toEqual(cursor);
      expect(() =>
        parseDurableSourceCursor(source, wire.replace('"owner"', '"complete"')),
      ).toThrow();
    }
    expect(() =>
      ModernmuscleCursor.parse(HawaiipartsCursor.initial()),
    ).toThrow();
    expect(SourceValidationPolicy.minimumUniqueInventory.hawaiiparts).toBe(35);
    expect(SourceValidationPolicy.minimumUniqueInventory.modernmuscle).toBe(
      300,
    );
  });
});

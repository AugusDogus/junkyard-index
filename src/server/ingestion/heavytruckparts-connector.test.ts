import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { z } from "zod";
import {
  HTP_SUPPLIERS,
  htpCatalogUrl,
  htpStoreUrl,
} from "./heavytruckparts-yard-metadata";
import {
  HTP_REJECTED_SUPPLIERS,
  HTP_RETAIL_SUPPLIER,
} from "./heavytruckparts-qualification-fixtures";
import { parseHtpCatalog, parseHtpStore } from "./heavytruckparts-catalog";
import { htpRoster, type HtpPage } from "./heavytruckparts-census";
import {
  HeavytruckpartsCursor,
  type HtpCursor,
} from "./heavytruckparts-cursor";
import {
  fetchHtpPage,
  htpAdvance,
  HeavytruckpartsProviderError,
  streamHeavytruckpartsInventory,
} from "./heavytruckparts-connector";
import {
  htpExclusion,
  htpSnapshot,
  htpSupplierSnapshot,
  type HtpVehicle,
} from "./heavytruckparts-snapshot";
import { IngestionSourceFlags } from "./ingestion-source-flags";
import type { HtpSupplier } from "./heavytruckparts-yard-metadata";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";

// Lossless line dictionary keeps shared HTP page chrome once, including scripts.
const saved = z
  .object({
    chunks: z.array(z.string()),
    pages: z.record(z.array(z.number().int().nonnegative())),
  })
  .strict()
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL(
            "./heavytruckparts-test-fixtures/native.json.gz",
            import.meta.url,
          ),
        ),
      ).toString(),
    ),
  );
const bodies = new Map<string, string>();
function fixtureBytes(key: string): Buffer {
  const parts = saved.pages[key];
  if (parts === undefined) throw new Error("Missing saved response " + key);
  return Buffer.concat(
    parts.map((index) => {
      const chunk = saved.chunks[index];
      if (chunk === undefined) throw new Error("Invalid fixture line " + index);
      return Buffer.from(chunk, "base64");
    }),
  );
}
function read(key: string): string {
  const cached = bodies.get(key);
  if (cached !== undefined) return cached;
  const raw = fixtureBytes(key).toString();
  bodies.set(key, raw);
  return raw;
}
function census(s: HtpSupplier) {
  const total = parseHtpStore(read(s.code + "-store"), s);
  const pages: HtpPage[] = [];
  for (const direction of ["DESC", "ASC"] as const)
    for (let page = 1; page <= Math.ceil(total / 25); page++)
      pages.push(
        parseHtpCatalog(
          read(`${s.code}-${direction.toLowerCase()}-${page}`),
          s,
          direction,
          page,
          total,
        ),
      );
  expect(parseHtpStore(read(s.code + "-store-closing"), s)).toBe(total);
  return { code: s.code, total, pages };
}
function response(url: string) {
  for (const s of HTP_SUPPLIERS) {
    if (url === htpStoreUrl(s)) return read(s.code + "-store");
    for (const direction of ["DESC", "ASC"] as const)
      for (let page = 1; page <= 80; page++)
        if (url === htpCatalogUrl(s, direction, page))
          return read(`${s.code}-${direction.toLowerCase()}-${page}`);
  }
  throw new Error("Unexpected offline URL " + url);
}
const first = HTP_SUPPLIERS[0];

describe("HeavyTruckParts marketplace", () => {
  test("saved original bytes and serial four-second request receipts remain auditable", () => {
    const receipts = z
      .array(
        z.object({
          key: z.string(),
          url: z.string(),
          status: z.number(),
          started: z.number(),
          finished: z.number(),
          bytes: z.number(),
        }),
      )
      .parse(
        JSON.parse(
          readFileSync(
            new URL(
              "./heavytruckparts-test-fixtures/receipts.json",
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      );
    expect(receipts).toHaveLength(174);
    expect(
      receipts.filter(
        (r) => new URL(r.url).hostname === "www.heavytruckparts.net",
      ),
    ).toHaveLength(157);
    for (const [index, r] of receipts.entries()) {
      expect(fixtureBytes(r.key).byteLength).toBe(r.bytes);
      expect(r.finished).toBeGreaterThanOrEqual(r.started);
      const prior = receipts[index - 1];
      if (prior) expect(r.started - prior.finished).toBeGreaterThanOrEqual(4);
    }
  });
  test("every yard coordinate comes from its saved exact-address geocoder match", () => {
    for (const s of HTP_SUPPLIERS) {
      if (s.code === "crest" || s.code === "american") {
        const matches = z
          .array(
            z.object({
              lat: z.string(),
              lon: z.string(),
              address: z.object({
                house_number: z.string(),
                postcode: z.string(),
                "ISO3166-2-lvl4": z.string(),
              }),
            }),
          )
          .parse(JSON.parse(read(s.code + "-nominatim-address")));
        expect(matches).toHaveLength(1);
        const m = matches[0];
        if (!m) throw new Error("No OSM address match");
        const houseNumber = s.yard.address?.split(" ")[0];
        if (!houseNumber) throw new Error("Yard lacks a house number");
        expect(m.address.house_number).toBe(houseNumber);
        expect(m.address.postcode).toBe(s.yard.postalCode);
        expect(m.address["ISO3166-2-lvl4"]).toBe("US-" + s.yard.state);
        expect([Number(m.lat), Number(m.lon)]).toEqual([
          s.yard.lat,
          s.yard.lng,
        ]);
      } else {
        const result = z
          .object({
            result: z.object({
              addressMatches: z.array(
                z.object({
                  coordinates: z.object({ x: z.number(), y: z.number() }),
                  addressComponents: z.object({
                    state: z.string(),
                    zip: z.string(),
                  }),
                }),
              ),
            }),
          })
          .parse(JSON.parse(read(s.code + "-census")));
        expect(result.result.addressMatches).toHaveLength(1);
        const m = result.result.addressMatches[0];
        if (!m) throw new Error("No Census address match");
        expect(m.addressComponents.state).toBe(s.yard.state);
        expect(m.addressComponents.zip).toBe(s.yard.postalCode);
        expect([m.coordinates.y, m.coordinates.x]).toEqual([
          s.yard.lat,
          s.yard.lng,
        ]);
      }
    }
  });
  test("complete saved native rosters reconcile to each independent store count", () => {
    const censuses = HTP_SUPPLIERS.map(census);
    const snapshot = htpSnapshot(censuses, null);
    expect(new Set(snapshot.vehicles.map((v) => v.stateAbbr)).size).toBe(6);
    expect(
      snapshot.vehicles.every(
        (v) =>
          v.source === "heavytruckparts" &&
          v.detailsUrl?.startsWith("https://www.heavytruckparts.net/item/") &&
          v.lat !== 0 &&
          v.lng !== 0,
      ),
    ).toBe(true);
    expect(snapshot.vehicles).toHaveLength(838);
    expect(snapshot.accounting).toEqual({
      recordsProcessed: 1125,
      recordsRejected: 20,
      recordsExcluded: 256,
      duplicateVehicles: 11,
    });
    expect(snapshot.accounting.recordsExcluded).toBeGreaterThan(200);
    expect(snapshot.accounting.duplicateVehicles).toBe(11);
  });
  test("retail stock stays out, while explicit non-running and salvage units qualify", () => {
    const results = HTP_SUPPLIERS.map((s) => {
      const c = census(s);
      return {
        s,
        snapshot: htpSupplierSnapshot(s, htpRoster(s, c.pages, c.total)),
      };
    });
    expect(
      results.find((r) => r.s.code === "rydemore")?.snapshot.vehicles,
    ).toHaveLength(8);
    expect(HTP_SUPPLIERS.map((s) => s.supplier)).not.toContain(
      HTP_RETAIL_SUPPLIER.supplier,
    );
    expect(
      results.find((r) => r.s.code === "american")?.snapshot.vehicles,
    ).toHaveLength(3);
    expect(
      results.find((r) => r.s.code === "catruck")?.snapshot.vehicles,
    ).toHaveLength(4);
  });
  test("saved Please Call dealer stock and Crest running firetruck stay out", () => {
    const bw = HTP_RETAIL_SUPPLIER;
    const c = census(bw);
    const rows = htpRoster(bw, c.pages, c.total);
    const sprinter = rows.find((r) => r.id === "9577");
    if (!sprinter) throw new Error("Saved B&W Sprinter missing");
    expect(sprinter.price).toBe("Please Call");
    expect(sprinter.description).toContain("40,745 Miles");
    expect(htpExclusion(sprinter, bw)).toBe("retail-resale");
    const donor = rows.find((r) => /needs injection pump/i.test(r.description));
    if (!donor) throw new Error("Saved non-running B&W truck missing");
    expect(htpExclusion(donor, bw)).toBeNull();
    const mileageStock = rows.filter(
      (r) => r.price === "Please Call" && /[\d,]+\s+miles/i.test(r.description),
    );
    expect(mileageStock.length).toBeGreaterThan(0);
    expect(
      mileageStock.every((r) => htpExclusion(r, bw) === "retail-resale"),
    ).toBe(true);
    const crest = HTP_SUPPLIERS.find((s) => s.code === "crest");
    if (!crest) throw new Error("Crest fixture missing");
    const cc = census(crest);
    const crestRows = htpRoster(crest, cc.pages, cc.total);
    const firetruck = crestRows.find((r) =>
      /TEST DRVN RUNS GREAT/i.test(r.description),
    );
    if (!firetruck) throw new Error("Saved retail Crest firetruck missing");
    expect(htpExclusion(firetruck, crest)).toBe("retail-resale");
    // A second listing for this VIN explicitly describes a dismantled donor.
    const dismantled = crestRows.find((r) => r.id === "11549");
    if (!dismantled) throw new Error("Saved dismantled Crest donor missing");
    expect(dismantled.vin).toBe(firetruck.vin);
    expect(htpExclusion(dismantled, crest)).toBeNull();
    const snapshot = htpSupplierSnapshot(crest, crestRows);
    expect(
      snapshot.vehicles.find((v) => v.vin === firetruck.vin)?.detailsUrl,
    ).toBe(dismantled.url);
  });
  test("native HTP make truncations resolve to canonical display makes", () => {
    const aliases = [
      ["WESTERN STAR TR", "Western Star"],
      ["WHITEGMC", "White GMC"],
      ["UD TRUCK", "UD"],
    ] as const;
    for (const [native, canonical] of aliases) {
      const supplier = HTP_SUPPLIERS.find(
        (s) => s.code === (native === "UD TRUCK" ? "crest" : "westside"),
      );
      if (!supplier) throw new Error("Saved supplier missing");
      const c = census(supplier);
      const row = htpRoster(supplier, c.pages, c.total).find(
        (r) => r.make === native,
      );
      if (!row) throw new Error("Saved make missing: " + native);
      const snapshot = htpSupplierSnapshot({ ...supplier, minimum: 1 }, [row]);
      expect(snapshot.vehicles[0]?.make).toBe(canonical);
    }
  });
  test.each([...HTP_REJECTED_SUPPLIERS])(
    "$code fails its own 10% guard",
    (s) => {
      const c = census(s);
      expect(() =>
        htpSupplierSnapshot(s, htpRoster(s, c.pages, c.total)),
      ).toThrow("supplier quality failed");
    },
  );
  test("intentional scope exclusions never hide identity rejects or discard CAT road trucks", () => {
    const s = HTP_SUPPLIERS.find((s) => s.code === "westside");
    if (!s) throw new Error("West Side fixture missing");
    const c = census(s),
      rows = htpRoster(s, c.pages, c.total);
    const truck = rows.find((r) => r.make === "CAT" && r.model === "CT660");
    if (!truck) throw new Error("CAT road truck fixture missing");
    expect(htpExclusion(truck, s)).toBeNull();
    for (const row of rows.filter((r) =>
      /^(?:Attachment|BOAT|Epic|ROADTEC|Sullair|Talbert|Universal)$/.test(
        r.make,
      ),
    ))
      expect(htpExclusion(row, s)).toBe("equipment-trailer-or-golf-cart");
    const accepted = htpSupplierSnapshot(s, rows).vehicles[0];
    const base = rows.find((r) => r.url === accepted?.detailsUrl);
    if (!base) throw new Error("Accepted road vehicle missing");
    const small = { ...s, minimum: 1 };
    expect(() =>
      htpSupplierSnapshot(small, [
        base,
        { ...base, id: "999999", vin: "INVALID" },
      ]),
    ).toThrow("supplier quality");
    expect(() =>
      htpSupplierSnapshot(
        small,
        Array.from({ length: 5 }, (_, i) => ({
          ...base,
          id: String(900000 + i),
        })),
      ),
    ).toThrow("supplier quality");
    expect(() =>
      htpSupplierSnapshot(small, [
        base,
        { ...base, id: "999999", model: "CONFLICT" },
      ]),
    ).toThrow("conflict");
    expect(() =>
      htpSupplierSnapshot(small, [
        base,
        { ...base, id: "999999", model: "UNKNOWN" },
      ]),
    ).toThrow("overlaps");
  });
  test("dual orders reject missing pages, duplicate destinations and changing native claims", () => {
    const c = census(first),
      row = c.pages[0]?.records[0];
    if (!row) throw new Error("fixture row missing");
    expect(() => htpRoster(first, c.pages.slice(1), c.total)).toThrow(
      "year order",
    );
    const changed = c.pages.map((p) =>
      p.direction === "ASC"
        ? {
            ...p,
            records: p.records.map((r) =>
              r.id === row.id ? { ...r, model: r.model + " CHANGED" } : r,
            ),
          }
        : p,
    );
    expect(() => htpRoster(first, changed, c.total)).toThrow("changed between");
    expect(() => htpRoster(first, c.pages, c.total + 1)).toThrow();
  });
  test("owner, item category, store, pagination and truncation drift stop collection", () => {
    const raw = read(first.code + "-desc-1"),
      total = parseHtpStore(read(first.code + "-store"), first);
    for (const bad of [
      raw.replaceAll("/4594927/1/", "/4594927/2/"),
      raw.replaceAll(
        "/Complete-Vehicle/4594927/",
        "/Whole-Truck-For-Resale/4594927/",
      ),
      raw.replaceAll(
        "Location:</strong> FITCHBURG MA",
        "Location:</strong> BOSTON MA",
      ),
      raw.replaceAll("page=2", "page=3"),
      raw.slice(0, raw.lastIndexOf("</body>")),
    ])
      expect(() => parseHtpCatalog(bad, first, "DESC", 1, total)).toThrow();
    expect(() =>
      parseHtpStore(
        read(first.code + "-store").replaceAll(
          "88 BENSON STREET",
          "89 BENSON STREET",
        ),
        first,
      ),
    ).toThrow("identity");
  });
  test("cursor binds supplier order, page frontier, accounting and corruption checksum", () => {
    const initial = HeavytruckpartsCursor.initial();
    const next = htpAdvance(initial, read(first.code + "-store"));
    expect(
      parseDurableSourceCursor(
        "heavytruckparts",
        serializeDurableSourceCursor(next),
      ),
    ).toEqual(next);
    expect(() =>
      HeavytruckpartsCursor.parse({ ...next, requests: 99 }),
    ).toThrow();
    expect(() =>
      HeavytruckpartsCursor.parse({ ...next, checksum: "00000000" }),
    ).toThrow();
    const { checksum: _checksum, ...state } = initial;
    void _checksum;
    expect(() =>
      HeavytruckpartsCursor.checkpoint({ ...state, phase: "ready" }),
    ).toThrow("terminal");
    expect(() =>
      HeavytruckpartsCursor.checkpoint({
        ...next,
        pages: [{ direction: "ASC", page: 1, records: [] }],
      }),
    ).toThrow();
  });
  test("chunked offline replay withholds all output until the source closes, then terminal resume fetches nothing", async () => {
    let cursor: HtpCursor = HeavytruckpartsCursor.initial(),
      requests = 0;
    const vehicles: HtpVehicle[] = [],
      yards: string[] = [];
    while (cursor.phase !== "complete") {
      const result = await Effect.runPromise(
        streamHeavytruckpartsInventory({
          startCursor: cursor,
          maxPages: 8,
          readPage: (url) => {
            requests++;
            return Effect.succeed(response(url));
          },
          onBatch: (rows) =>
            Effect.sync(() => {
              vehicles.push(...rows);
            }),
          onYards: (rows) =>
            Effect.sync(() => {
              yards.push(...rows.map((y) => y.code));
            }),
        }),
      );
      cursor = result.cursor;
      if (result.status === "paused") {
        expect(result.count).toBe(0);
        expect(vehicles).toHaveLength(0);
        expect(yards).toHaveLength(0);
      }
    }
    expect(requests).toBe(cursor.requests);
    expect(vehicles.length).toBeGreaterThan(700);
    expect(yards).toHaveLength(HTP_SUPPLIERS.length);
    const terminal = await Effect.runPromise(
      streamHeavytruckpartsInventory({
        startCursor: cursor,
        readPage: () => Effect.die("terminal fetched"),
        onBatch: () => Effect.die("terminal emitted"),
      }),
    );
    expect(terminal.count).toBe(0);
    expect(terminal.pagesProcessed).toBe(0);
  }, 15000);
  test("closing count changes and previous-count drift emit no partial source", async () => {
    const initial = HeavytruckpartsCursor.initial();
    let cursor = htpAdvance(initial, read(first.code + "-store"));
    while (cursor.phase === "catalog")
      cursor = htpAdvance(
        cursor,
        response(HeavytruckpartsCursor.nextUrl(cursor)),
      );
    expect(() =>
      htpAdvance(
        cursor,
        read(first.code + "-store").replace(
          "Complete Vehicle - 45",
          "Complete Vehicle - 46",
        ),
      ),
    ).toThrow("closing store count");
    const censuses = HTP_SUPPLIERS.map(census);
    expect(() => htpSnapshot(censuses, 10000)).toThrow("drift");
    const bad = await Effect.runPromiseExit(
      streamHeavytruckpartsInventory({
        startCursor: cursor,
        readPage: () =>
          Effect.fail(new HeavytruckpartsProviderError("test", "blocked")),
        onBatch: () => Effect.die("emitted"),
      }),
    );
    expect(bad._tag).toBe("Failure");
  });
  test("new source runs unless its flag serves false and HTTP destinations are supplier-bound", async () => {
    expect(IngestionSourceFlags.resolve({})).toContain("heavytruckparts");
    for (const url of [
      "https://example.com/",
      htpStoreUrl(HTP_RETAIL_SUPPLIER),
      htpCatalogUrl(HTP_RETAIL_SUPPLIER, "DESC", 1),
      htpStoreUrl(first) + "&page=1",
      htpCatalogUrl(first, "ASC", 1) + "&year_start=2000",
      htpCatalogUrl(first, "DESC", 1).replace("4594927", "254076"),
    ]) {
      const result = await Effect.runPromiseExit(fetchHtpPage(url));
      expect(result._tag).toBe("Failure");
    }
  });
  test("2026-11-19 Request Info item control is not a second destination, and year ties overlap pages", () => {
    const live = z
      .object({
        note: z.string(),
        receipts: z.array(
          z
            .object({
              key: z.string(),
              url: z.string(),
              status: z.literal(200),
              bytes: z.number(),
              started: z.number(),
              finished: z.number(),
            })
            .strict(),
        ),
        total: z.number().int().positive(),
        pages: z.record(z.string()),
      })
      .strict()
      .parse(
        JSON.parse(
          gunzipSync(
            readFileSync(
              new URL(
                "./heavytruckparts-test-fixtures/unstable-year-ties.json.gz",
                import.meta.url,
              ),
            ),
          ).toString(),
        ),
      );
    const westside = HTP_SUPPLIERS.find((s) => s.code === "westside");
    if (!westside) throw new Error("West Side supplier missing");
    const page = (n: number, change = (raw: string) => raw) => {
      const raw = live.pages[`westside-desc-${n}`];
      if (raw === undefined) throw new Error("Missing live page " + n);
      return parseHtpCatalog(change(raw), westside, "DESC", n, live.total);
    };
    expect(live.total).toBe(623);
    const [p1, p2, p25] = [page(1), page(2), page(25)];
    expect(p1.records).toHaveLength(25);
    expect(p2.records).toHaveLength(25);
    expect(p25.records).toHaveLength(live.total - 600);
    expect(p1.records[0]?.url).toBe(
      "https://www.heavytruckparts.net/item/Mack/Gr64f/Complete-Vehicle/7641244/1/147606",
    );
    // Native year ties no longer break by item ID, so offset pages overlap.
    // htpRoster treats repeats as traversal overlap and still needs every ID.
    expect(
      p2.records
        .filter((r) => p1.records.some((o) => o.id === r.id))
        .map((r) => r.id)
        .sort(),
    ).toEqual(["146082", "146132"]);
    const inquiry =
      "/item/Mack/Gr64f/Complete-Vehicle/7641244/1/147606?inquiry=true";
    for (const change of [
      (raw: string) =>
        raw.replace(inquiry, inquiry.replace("147606", "147651")),
      (raw: string) => raw.replace("Request Info", "Ask Seller"),
    ])
      expect(() => page(1, change)).toThrow("conflicting destination");
  });
});

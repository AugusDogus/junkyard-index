import { z } from "zod";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { streamArioYard } from "./autorecycler-ario-connector";
import { readArioYard } from "./autorecycler-ario-inventory";
import { ARIO_CUSTOMER_YARDS } from "./autorecycler-ario-yards";
import type { ArioClient } from "./autorecycler-ario-client";
import type { CanonicalVehicle } from "./types";
import { gunzipSync } from "node:zlib";

async function savedClient(): Promise<ArioClient> {
  const directory: unknown = await Bun.file(
    new URL("./fixtures/ario/yards.json", import.meta.url),
  ).json();
  const cache = new Map<string, Record<string, unknown>>();
  const opened = new Set<string>();
  return {
    yards: async () => directory,
    page: async (slug, offset) => {
      let pages = cache.get(slug);
      if (!pages) {
        const bytes = await Bun.file(
          new URL(`./fixtures/ario/${slug}.json.gz`, import.meta.url),
        ).arrayBuffer();
        pages = z
          .record(z.unknown())
          .parse(JSON.parse(gunzipSync(new Uint8Array(bytes)).toString()));
        cache.set(slug, pages);
      }
      const key = offset === 0 && opened.has(slug) ? "closing" : String(offset);
      if (offset === 0) opened.add(slug);
      const page = pages[key];
      if (!page)
        throw new Error(`Unsaved Ario request ${slug} offset=${offset}`);
      return page;
    },
  };
}

const expectedCounts: Record<
  (typeof ARIO_CUSTOMER_YARDS)[number]["slug"],
  number
> = {
  "a-a-auto-recycling": 1134,
  "auto-parts-u-pull-nc": 839,
  "auto-parts-u-pull-shelby-nc": 1315,
  "ez-pull-n-pay-atlanta": 1043,
  "ez-pull-n-pay-birmingham": 725,
  "ez-pull-n-pay-columbus": 940,
  "ez-pull-n-pay-decatur": 1010,
  "ez-pull-n-pay-montgomery": 1078,
  "ez-pull-n-pay-stockbridge": 1104,
  "ez-pull-n-pay-warner-robins": 1158,
  "foss-havelock": 504,
  "foss-jacksonville": 1137,
  "foss-la-grange": 968,
  "foss-recycling": 761,
  "foss-wilson": 713,
  "foss-winston-salem": 1343,
  "l-and-l-u-pull": 1445,
  "prestige-pull-your-part-houston-tx": 1305,
  "samson-auto-salvage": 283,
  "santa-maria-recycling-center": 0,
};

test("replays complete Ario customer inventories with no network, including suppressed rank holes", async () => {
  const client = await savedClient();
  for (const [index, yard] of ARIO_CUSTOMER_YARDS.entries()) {
    const vehicles: CanonicalVehicle[] = [];
    const result = await Effect.runPromise(
      streamArioYard(
        {
          yardIndex: index,
          asOf: Date.parse("2026-11-15T12:00:00Z"),
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles.push(...batch);
            }),
        },
        client,
      ),
    );
    expect(vehicles.length).toBe(expectedCounts[yard.slug]);
    expect(result.errors).toEqual([]);
    expect(result.status).toBe("paused");
    expect(result.accounting.recordsProcessed).toBeGreaterThan(100);
    if (yard.slug === "santa-maria-recycling-center") {
      expect(vehicles).toEqual([]);
      expect(result.selection).toBe("stale");
      expect(result.accounting.recordsExcluded).toBe(
        result.accounting.recordsProcessed,
      );
    } else expect(vehicles.length).toBeGreaterThan(100);
    for (const vehicle of vehicles) {
      expect(vehicle.locationCode).toEndWith(yard.legacyId);
      expect(vehicle.stateAbbr).toBe(yard.state);
      expect(vehicle.locationCity).toBe(yard.city);
      expect(vehicle.detailsUrl).toContain(`yard=${yard.slug}&inv=`);
      expect(vehicle.vin).not.toBe("");
    }
  }
}, 15_000);

test("rejects missing customers, changed ownership and changed catalogs before emitting a yard", async () => {
  const saved = await savedClient();
  await expect(
    Effect.runPromise(
      streamArioYard(
        { yardIndex: 0, onBatch: () => Effect.void },
        {
          ...saved,
          yards: async () => [],
        },
      ),
    ),
  ).rejects.toThrow("missing or changed ownership");
  const yard = ARIO_CUSTOMER_YARDS[0];
  if (!yard) throw new Error("Missing fixture yard");
  let calls = 0;
  await expect(
    readArioYard(
      {
        ...saved,
        page: async (slug, offset) => {
          const raw = await saved.page(slug, offset);
          if (++calls === 2) return { items: [], total: 1, yards_meta: [] };
          return raw;
        },
      },
      yard,
    ),
  ).rejects.toThrow("pagination evidence");
});

test("a fresher legacy yard wins without Ario vehicles, metadata or VIN observations", async () => {
  const client = await savedClient();
  let vehicles = 0;
  let yards = 0;
  const result = await Effect.runPromise(
    streamArioYard(
      {
        yardIndex: 0,
        asOf: Date.parse("2026-11-15T12:00:00Z"),
        legacyNewest: Date.parse("2026-11-14T12:00:00Z"),
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles += batch.length;
          }),
        onYards: (batch) =>
          Effect.sync(() => {
            yards += batch.length;
          }),
      },
      client,
    ),
  );
  expect(result.selection).toBe("legacy");
  expect(result.count).toBe(0);
  expect(vehicles).toBe(0);
  expect(yards).toBe(0);
  expect(result.accounting.recordsExcluded).toBe(
    result.accounting.recordsProcessed,
  );
});

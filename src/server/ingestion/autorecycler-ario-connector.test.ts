import { inventoryVinWithCheckDigit } from "./inventory-vin-check-digit";
import { validateSourceSnapshot } from "./source-validation";
import { inventoryVin } from "./inventory-vin";
import { z } from "zod";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { streamArioYard } from "./autorecycler-ario-connector";
import {
  ArioPageSchema,
  readArioYard,
  arioGeo,
  transformArioItem,
} from "./autorecycler-ario-inventory";
import {
  ARIO_CUSTOMER_YARDS,
  arioLocationCode,
  requiresArioCheckDigit,
} from "./autorecycler-ario-yards";
import type { ArioClient } from "./autorecycler-ario-client";
import type { CanonicalVehicle } from "./types";
import type { Yard } from "~/lib/yard";
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
  "cfc-recycling": 395,
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
    if (requiresArioCheckDigit(yard)) {
      expect(
        validateSourceSnapshot({
          source: "autorecycler",
          terminal: true,
          uniqueVehicles: vehicles.length,
          vehiclesProcessed: result.accounting.recordsProcessed,
          rejectedVehicles: result.accounting.recordsRejected,
          duplicateVehicles: result.accounting.duplicateVehicles,
          previousAcceptedCount: null,
          errors: [],
        }).errors,
      ).toEqual([]);
      for (const vehicle of vehicles)
        expect(
          inventoryVinWithCheckDigit(vehicle.vin, String(vehicle.year)),
        ).toBe(vehicle.vin);
    }
    for (const vehicle of vehicles) {
      expect(vehicle.locationCode).toBe(arioLocationCode(yard));
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

test.each(["2026-11-14T00:00:00.000Z", null, undefined])(
  "rejects a yard with no parseable addition dates (%s) before emitting inventory",
  async (date) => {
    const saved = await savedClient();
    let emitted = 0;
    await expect(
      Effect.runPromise(
        streamArioYard(
          {
            yardIndex: 0,
            asOf: Date.parse("2026-11-15T12:00:00Z"),
            onBatch: () =>
              Effect.sync(() => {
                emitted++;
              }),
            onYards: () =>
              Effect.sync(() => {
                emitted++;
              }),
          },
          {
            ...saved,
            page: async (slug, offset) => {
              const page = ArioPageSchema.parse(await saved.page(slug, offset));
              return {
                ...page,
                items: page.items.map((item) => ({
                  ...item,
                  ario_date_placed: null,
                  date_placed: date,
                })),
              };
            },
          },
        ),
      ),
    ).rejects.toThrow("no parseable addition dates");
    expect(emitted).toBe(0);
  },
);

test("Birmingham publishes the verified Ruffner Road yard instead of the downtown placeholder", async () => {
  const vehicles: CanonicalVehicle[] = [];
  const yards: Yard[] = [];
  await Effect.runPromise(
    streamArioYard(
      {
        yardIndex: ARIO_CUSTOMER_YARDS.findIndex(
          (yard) => yard.slug === "ez-pull-n-pay-birmingham",
        ),
        asOf: Date.parse("2026-11-15T12:00:00Z"),
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles.push(...batch);
          }),
        onYards: (batch) =>
          Effect.sync(() => {
            yards.push(...batch);
          }),
      },
      await savedClient(),
    ),
  );
  expect(vehicles).toHaveLength(725);
  expect(yards).toHaveLength(1);
  expect(yards[0]).toMatchObject({
    address: "1849 Ruffner Rd, Birmingham, AL 35210",
    lat: 33.5567534,
    lng: -86.6903392,
  });
  for (const vehicle of vehicles) {
    expect(vehicle.lat).toBe(33.5567534);
    expect(vehicle.lng).toBe(-86.6903392);
  }
});

test("CFC uses its owned website point and native yard UUID, rejecting every malformed VIN unchanged", async () => {
  const index = ARIO_CUSTOMER_YARDS.findIndex(
    (yard) => yard.slug === "cfc-recycling",
  );
  const config = ARIO_CUSTOMER_YARDS[index];
  if (!config || !("locationOverride" in config))
    throw new Error("Missing qualified CFC location");
  const owner = gunzipSync(
    await Bun.file(
      new URL("./fixtures/ario/cfc-owner.html.gz", import.meta.url),
    ).bytes(),
  ).toString();
  expect(owner).toContain(
    "https://ario.autorecycler.io/yard/cfc-recycling?embed=1",
  );
  expect(owner).toContain('"streetAddress":"2716 Dowdy Ferry Rd"');
  expect(owner).toContain('"latitude":32.6619785,"longitude":-96.6729032');
  const vehicles: CanonicalVehicle[] = [];
  const yards: Yard[] = [];
  const result = await Effect.runPromise(
    streamArioYard(
      {
        yardIndex: index,
        asOf: Date.parse("2026-11-16T12:00:00Z"),
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles.push(...batch);
          }),
        onYards: (batch) =>
          Effect.sync(() => {
            yards.push(...batch);
          }),
      },
      await savedClient(),
    ),
  );
  expect(result.accounting).toEqual({
    recordsProcessed: 422,
    recordsExcluded: 0,
    recordsRejected: 27,
    duplicateVehicles: 0,
  });
  expect(yards).toHaveLength(1);
  expect(yards[0]).toMatchObject({
    code: "ario:9e650335-4efb-4664-ba19-b4f22a0f1775",
    address: "2716 Dowdy Ferry Rd, Dallas, TX 75217",
    lat: 32.6619785,
    lng: -96.6729032,
  });
  expect(vehicles).toHaveLength(395);
  for (const vehicle of vehicles) {
    expect(vehicle.locationCode).toBe(
      "ario:9e650335-4efb-4664-ba19-b4f22a0f1775",
    );
    expect(vehicle.lat).toBe(32.6619785);
    expect(vehicle.lng).toBe(-96.6729032);
  }
  const inventory = await readArioYard(await savedClient(), config);
  const malformed = inventory.items.filter(
    (item) => inventoryVin(item.vin ?? "", String(item.year ?? "")) === null,
  );
  expect(malformed).toHaveLength(15);
  expect(malformed.map((item) => item.vin)).toContain("WBAЗА5C52CF256492");
  expect(malformed.map((item) => item.vin)).toContain("2HGE J6572TH528443");
  const geo = arioGeo(
    config,
    "CFC Recycling",
    config.locationOverride.lat,
    config.locationOverride.lng,
  );
  for (const item of malformed) expect(transformArioItem(item, geo)).toBeNull();
});

test("every customer added after the original twenty validates VIN check digits", () => {
  expect(ARIO_CUSTOMER_YARDS.slice(0, 20).some(requiresArioCheckDigit)).toBe(
    false,
  );
  expect(ARIO_CUSTOMER_YARDS.slice(20).every(requiresArioCheckDigit)).toBe(
    true,
  );
});

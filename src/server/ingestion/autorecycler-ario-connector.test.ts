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
      const page = pages[String(offset)];
      if (!page)
        throw new Error(`Unsaved Ario request ${slug} offset=${offset}`);
      return page;
    },
  };
}

test("replays complete Ario customer inventories with no network, including suppressed rank holes", async () => {
  const client = await savedClient();
  for (const [index, yard] of ARIO_CUSTOMER_YARDS.entries()) {
    const vehicles: CanonicalVehicle[] = [];
    const result = await Effect.runPromise(
      streamArioYard(
        {
          yardIndex: index,
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles.push(...batch);
            }),
        },
        client,
      ),
    );
    expect(result.errors).toEqual([]);
    expect(result.status).toBe("paused");
    expect(result.accounting.recordsProcessed).toBeGreaterThan(100);
    expect(vehicles.length).toBeGreaterThan(100);
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

import { expect, test } from "bun:test";
import { Effect } from "effect";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { ArioYardsSchema, type ArioClient } from "./autorecycler-ario-client";
import { streamArioYard } from "./autorecycler-ario-connector";
import { ArioPageSchema } from "./autorecycler-ario-inventory";
import { ARIO_CUSTOMER_YARDS } from "./autorecycler-ario-yards";
import { inventoryVinWithCheckDigit } from "./inventory-vin-check-digit";
import type { CanonicalVehicle } from "./types";

const slug = "colorado-auto-and-parts-englewood-co";
async function capture() {
  const directory = ArioYardsSchema.parse(
    await Bun.file(
      new URL("./fixtures/ario/yards.json", import.meta.url),
    ).json(),
  );
  const bytes = await Bun.file(
    new URL(`./fixtures/ario/${slug}.json.gz`, import.meta.url),
  ).arrayBuffer();
  const pages = z
    .record(ArioPageSchema)
    .parse(JSON.parse(gunzipSync(new Uint8Array(bytes)).toString()));
  let opened = false;
  const reads: number[] = [];
  const client: ArioClient = {
    yards: async () => directory,
    page: async (_slug, offset) => {
      expect(_slug).toBe(slug);
      reads.push(offset);
      const key = opened && offset === 0 ? "closing" : String(offset);
      if (offset === 0) opened = true;
      const page = pages[key];
      if (!page) throw new Error(`Unsaved Colorado inventory window ${key}`);
      return page;
    },
  };
  return { client, pages, directory, reads };
}
async function publish(client: ArioClient) {
  const yardIndex = ARIO_CUSTOMER_YARDS.findIndex((yard) => yard.slug === slug);
  expect(yardIndex).toBeGreaterThanOrEqual(0);
  const vehicles: CanonicalVehicle[] = [];
  const result = await Effect.runPromise(
    streamArioYard(
      {
        yardIndex,
        asOf: Date.parse("2026-11-17T12:00:00Z"),
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles.push(...batch);
          }),
      },
      client,
    ),
  );
  return { vehicles, result };
}

test("adds Colorado through a complete native Ario census with check digits and a closing read", async () => {
  const saved = await capture();
  const { vehicles, result } = await publish(saved.client);
  expect(result.selection).toBe("ario");
  expect(saved.reads).toEqual([0, 100, 200, 0]);
  expect(vehicles).toHaveLength(283);
  expect(result.accounting).toEqual({
    recordsProcessed: 283,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  expect(new Set(vehicles.map((vehicle) => vehicle.vin)).size).toBe(283);
  expect(
    vehicles
      .map((vehicle) => vehicle.availableDate)
      .sort()
      .at(-1),
  ).toStartWith("2026-10-07");
  for (const vehicle of vehicles) {
    expect(inventoryVinWithCheckDigit(vehicle.vin, String(vehicle.year))).toBe(
      vehicle.vin,
    );
    expect(vehicle.stateAbbr).toBe("CO");
    expect(vehicle.locationCity).toBe("Englewood");
    expect(vehicle.detailsUrl).toContain(`yard=${slug}&inv=`);
  }
});

test("quarantines a complete Colorado census below its 94-donor floor", async () => {
  const saved = await capture();
  const opening = saved.pages["0"];
  if (!opening) throw new Error("Missing saved opening window");
  const items = opening.items
    .slice(0, 93)
    .map((item) => ({ ...item, total_yard_inventory: 93 }));
  const { vehicles, result } = await publish({
    ...saved.client,
    page: async () => ({
      items,
      total: 93,
      yards_meta: [
        {
          yard: slug,
          returned: 93,
          total_matching: 93,
          truncated: false,
          next_offset: 93,
        },
      ],
    }),
  });
  expect(vehicles).toEqual([]);
  expect(result.selection).toBe("quarantined");
  expect(result.warnings.join(" ")).toContain("94");
});

test("rejects changed native feed authority before reading Colorado inventory", async () => {
  const saved = await capture();
  await expect(
    publish({
      ...saved.client,
      yards: async () =>
        saved.directory.map((yard) =>
          yard.slug === slug
            ? { ...yard, data: { ...yard.data, crush_client_id: "9999" } }
            : yard,
        ),
    }),
  ).rejects.toThrow("native feed");
  expect(saved.reads).toEqual([]);
});

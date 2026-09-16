import { describe, expect, test } from "bun:test";
import {
  parseTapInventoryCount,
  transformTapInventoryProduct,
} from "./tap-inventory-transform";
import type { TapInventorySearchProduct } from "./tap-inventory-client";
import { TEARAPART_SITE_CONFIG, UPULLITNE_SITE_CONFIG } from "./tap-sites";
import type { CanonicalVehicle } from "./types";
import { Schema } from "effect";
import { TapInventorySearchProductSchema } from "./tap-inventory-client";

function fixtureUrl(fileName: string): URL {
  return new URL(`./fixtures/${fileName}`, import.meta.url);
}

async function firstSearchProduct(
  fileName: string,
): Promise<TapInventorySearchProduct> {
  const payload = Schema.decodeUnknownSync(
    Schema.Struct({
      products: Schema.Array(TapInventorySearchProductSchema),
    }),
  )(await Bun.file(fixtureUrl(fileName)).json());
  const product = payload.products[0];
  if (!product) throw new Error(`TAP fixture ${fileName} contains no products`);
  return product;
}

describe("transformTapInventoryProduct", () => {
  test("preserves a live Tear-A-Part vehicle without a yard row or arrival date", () => {
    const product = Schema.decodeUnknownSync(TapInventorySearchProductSchema)({
      stocknumber: "STK56911",
      iyear: "1996",
      make: "MITSUBISHI",
      model: "COURIER",
      color: "GREEN",
      vin: "JA4MR51M5TJ005340",
      image_url: "",
    });
    const store = TEARAPART_SITE_CONFIG.storeLocations["SALT LAKE CITY"];
    if (!store) throw new Error("Missing Salt Lake City test configuration");
    expect(
      transformTapInventoryProduct(product, store, TEARAPART_SITE_CONFIG),
    ).toMatchObject({
      source: "tearapart",
      vin: "JA4MR51M5TJ005340",
      row: null,
      availableDate: null,
    });
  });
  test("maps a Tear-A-Part product onto the canonical vehicle shape", async () => {
    const product = await firstSearchProduct(
      "tap-tearapart-search-salt-lake-city.json",
    );
    const store = TEARAPART_SITE_CONFIG.storeLocations["SALT LAKE CITY"];

    expect(store).toBeDefined();
    const vehicle =
      store &&
      transformTapInventoryProduct(product, store, TEARAPART_SITE_CONFIG);

    expect(vehicle).not.toBeNull();
    expect(vehicle).toEqual({
      vin: "JG1MR2158JK724014",
      source: "tearapart",
      year: 1988,
      make: "Chevrolet",
      model: "SPRINT",
      color: "Red",
      stockNumber: "STK239020",
      imageUrl: null,
      availableDate: "2026-07-14T08:48:09.737",
      locationCode: "SALT LAKE CITY",
      locationName: "Tear-A-Part - Salt Lake City",
      locationCity: "Salt Lake City",
      state: "Utah",
      stateAbbr: "UT",
      lat: 40.7535,
      lng: -111.94,
      section: null,
      row: "6",
      space: null,
      detailsUrl: "https://tearapart.com/inventory/",
      partsUrl: "https://tearapart.com/price-list/",
      pricesUrl: "https://tearapart.com/price-list/",
      engine: null,
      trim: null,
      transmission: null,
    });
  });

  test.each([
    ["SALT LAKE CITY", "tap-tearapart-search-salt-lake-city.json"],
    ["OGDEN", "tap-tearapart-search-ogden.json"],
  ])("does not invent stock links for %s", async (code, fixture) => {
    const product = await firstSearchProduct(fixture);
    const store = TEARAPART_SITE_CONFIG.storeLocations[code];
    if (!store) throw new Error(`Missing ${code} test configuration`);

    // Special stock formats are synthetic, not observed in the live Utah feed.
    for (const stocknumber of [product.stocknumber, "STK/001 A&B?#", ""]) {
      const vehicle = transformTapInventoryProduct(
        { ...product, stocknumber },
        store,
        TEARAPART_SITE_CONFIG,
      );
      expect(vehicle?.detailsUrl).toBe("https://tearapart.com/inventory/");
      expect(vehicle?.stockNumber).toBe(stocknumber || null);
      expect(vehicle?.vin).toBe(product.vin.trim());
    }
  });

  test("keeps supplied vehicle images and treats absent photos as absent", async () => {
    const product = await firstSearchProduct("tap-tearapart-search-ogden.json");
    const store = TEARAPART_SITE_CONFIG.storeLocations.OGDEN;
    if (!store) throw new Error("Missing Ogden test configuration");
    // Synthetic photo markup ensures placeholder handling cannot discard photos
    // if the provider starts supplying them again.
    const photo = "https://images.example.com/STK100580.jpg";
    for (const { image_url, expected } of [
      { image_url: product.image_url, expected: null },
      { image_url: "", expected: null },
      {
        image_url: `<a href='${photo}'><img src='${photo}'></a>`,
        expected: photo,
      },
    ]) {
      expect(
        transformTapInventoryProduct(
          { ...product, image_url },
          store,
          TEARAPART_SITE_CONFIG,
        )?.imageUrl,
      ).toBe(expected);
    }
  });

  test("preserves Nebraska links, image extraction, and vehicle metadata", () => {
    const store = UPULLITNE_SITE_CONFIG.storeLocations.LINCOLN;
    if (!store) throw new Error("Missing Lincoln test configuration");
    const product = {
      stocknumber: "LCN062459",
      iyear: "2001",
      make: "FORD",
      model: "FOCUS",
      vehicle_row: "403",
      yard_in_date: "2026-08-03T10:26:45.860",
      color: "SILVER",
      vin: "1FAHP34321W208275",
      image_url:
        '<a href="https://upullitne.com/inventory-photos/resized-images/coming-soon-150x113.png"><img src="https://upullitne.com/inventory-photos/resized-images/coming-soon-150x113.png"></a>',
    } satisfies TapInventorySearchProduct;
    expect(
      transformTapInventoryProduct(product, store, UPULLITNE_SITE_CONFIG),
    ).toEqual({
      vin: "1FAHP34321W208275",
      source: "upullitne",
      year: 2001,
      make: "Ford",
      model: "FOCUS",
      color: "Silver",
      stockNumber: "LCN062459",
      imageUrl:
        "https://upullitne.com/inventory-photos/resized-images/coming-soon-150x113.png",
      availableDate: "2026-08-03T10:26:45.860",
      locationCode: "LINCOLN",
      locationName: "U Pull-It Nebraska - Lincoln",
      locationCity: "Lincoln",
      state: "Nebraska",
      stateAbbr: "NE",
      lat: 40.8715,
      lng: -96.6256,
      section: null,
      row: "403",
      space: null,
      detailsUrl: "https://upullitne.com/search-inventory/?stock=LCN062459",
      partsUrl: "https://upullitne.com/parts-pricelist/",
      pricesUrl: "https://upullitne.com/parts-pricelist/",
      engine: null,
      trim: null,
      transmission: null,
    });
  });

  test("still yields a CanonicalVehicle for pipeline-bound sites", async () => {
    const product = await firstSearchProduct("tap-tearapart-search-ogden.json");
    const store = UPULLITNE_SITE_CONFIG.storeLocations.LINCOLN;
    expect(store).toBeDefined();
    if (!store) return;

    const vehicle = transformTapInventoryProduct(
      product,
      store,
      UPULLITNE_SITE_CONFIG,
    );

    const canonical: CanonicalVehicle | null = vehicle;
    expect(canonical?.source).toBe("upullitne");
    expect(vehicle?.partsUrl).toBe("https://upullitne.com/parts-pricelist/");
  });
});

describe("parseTapInventoryCount", () => {
  test("extracts the result count from the live message markup", async () => {
    const payload = JSON.parse(
      await Bun.file(
        fixtureUrl("tap-tearapart-search-salt-lake-city.json"),
      ).text(),
    ) as { message: string };
    expect(parseTapInventoryCount(payload.message)).toBe(837);
    expect(parseTapInventoryCount("no results here")).toBeNull();
  });
});

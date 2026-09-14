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
      imageUrl:
        "https://tearapart.com/inventory-photos/resized-images/coming-soon-150x113.png",
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
      detailsUrl: "https://tearapart.com/inventory/?stock=STK239020",
      partsUrl: "https://tearapart.com/price-list/",
      pricesUrl: "https://tearapart.com/price-list/",
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

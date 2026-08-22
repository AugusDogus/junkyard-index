import { describe, expect, test } from "bun:test";
import {
  parseTapInventoryCount,
  transformTapInventoryProduct,
} from "./tap-inventory-transform";
import type { TapInventorySearchProduct } from "./tap-inventory-client";
import { TEARAPART_SITE_CONFIG, UPULLITNE_SITE_CONFIG } from "./tap-sites";
import type { CanonicalVehicle } from "./types";

function fixtureUrl(fileName: string): URL {
  return new URL(`./fixtures/${fileName}`, import.meta.url);
}

async function firstSearchProduct(
  fileName: string,
): Promise<TapInventorySearchProduct> {
  const payload = JSON.parse(await Bun.file(fixtureUrl(fileName)).text()) as {
    products: TapInventorySearchProduct[];
  };
  return payload.products[0]!;
}

describe("transformTapInventoryProduct", () => {
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

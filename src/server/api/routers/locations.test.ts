import { afterEach, describe, expect, test } from "bun:test";
import {
  parsePypLocationsFromHtml,
  shouldDisablePypFetch,
} from "./locations";

const originalDisablePypFetch = process.env.DISABLE_PYP_FETCH;

afterEach(() => {
  process.env.DISABLE_PYP_FETCH = originalDisablePypFetch;
});

describe("locations helpers", () => {
  test("parses PYP locations from embedded HTML", () => {
    const html = `
      <html>
        <script>
          var _locationList = [{
            "LocationCode": "1229",
            "LocationPageURL": "/inventory/sun-valley-1229/",
            "Name": "Pick Your Part - Sun Valley",
            "DisplayName": "Sun Valley",
            "Address": "11201 Pendleton St.",
            "City": "Sun Valley",
            "State": "California",
            "StateAbbr": "CA",
            "Zip": "91352",
            "Phone": "(800) 962-2277",
            "Lat": 34.2284,
            "Lng": -118.3929,
            "Distance": 0,
            "LegacyCode": "229",
            "Primo": "",
            "Urls": {
              "Store": "/inventory/sun-valley-1229/",
              "Interchange": "/parts/sun-valley-1229/",
              "Inventory": "/inventory/sun-valley-1229/",
              "Prices": "/prices/sun-valley-1229/",
              "Directions": "/directions",
              "SellACar": "/sell",
              "Contact": "/contact",
              "CustomerServiceChat": null,
              "CarbuyChat": null,
              "Deals": "/deals",
              "Parts": "/parts/sun-valley-1229/"
            }
          }];
        </script>
      </html>
    `;

    const locations = parsePypLocationsFromHtml(html);
    expect(locations).toHaveLength(1);
    expect(locations[0]?.locationCode).toBe("1229");
    expect(locations[0]?.displayName).toBe("Sun Valley");
    expect(locations[0]?.source).toBe("pyp");
    expect(locations[0]?.urls.parts).toBe("/parts/sun-valley-1229/");
  });

  test("returns empty when no embedded PYP locations exist", () => {
    expect(parsePypLocationsFromHtml("<html></html>")).toEqual([]);
  });

  test("treats common env values as disabling PYP fetch", () => {
    process.env.DISABLE_PYP_FETCH = "1";
    expect(shouldDisablePypFetch()).toBe(true);

    process.env.DISABLE_PYP_FETCH = "true";
    expect(shouldDisablePypFetch()).toBe(true);

    process.env.DISABLE_PYP_FETCH = "TRUE";
    expect(shouldDisablePypFetch()).toBe(true);
  });

  test("leaves PYP fetch enabled for missing or unrelated env values", () => {
    delete process.env.DISABLE_PYP_FETCH;
    expect(shouldDisablePypFetch()).toBe(false);

    process.env.DISABLE_PYP_FETCH = "0";
    expect(shouldDisablePypFetch()).toBe(false);

    process.env.DISABLE_PYP_FETCH = "no";
    expect(shouldDisablePypFetch()).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { render } from "@react-email/components";
import { SearchAlertMatch } from "~/lib/search-alert-data";
import type { SearchVehicle } from "~/lib/types";
import { NewVehiclesAlert } from "./NewVehiclesAlert";

function makeVehicle(id: string): SearchVehicle {
  return {
    id,
    year: 2005,
    make: "Volvo",
    model: "XC90",
    color: "Blue",
    vin: `VIN${id}`,
    stockNumber: id,
    availableDate: "2026-08-21",
    source: "pyp",
    locationCode: "yard-1",
    locationName: "Example Yard",
    locationCity: "Chicago",
    state: "Illinois",
    stateAbbr: "IL",
    lat: 41.88,
    lng: -87.63,
    distance: 10,
    section: "A",
    row: "1",
    space: "2",
    imageUrl: null,
    detailsUrl: `https://example.com/vehicles/${id}`,
    partsUrl: "https://example.com/parts",
    pricesUrl: "https://example.com/prices",
  };
}

describe("NewVehiclesAlert", () => {
  test("renders multiple saved searches in one daily digest", async () => {
    const html = await render(
      NewVehiclesAlert({
        digest: {
          previewAlerts: [
            {
              searchName: "Volvo V8",
              query: "volvo",
              match: SearchAlertMatch.create(1, []),
              searchUrl: "https://example.com/search?query=volvo",
              unsubscribeUrl: "https://example.com/unsubscribe?id=1",
            },
            {
              searchName: "Pre-2000 Volvo",
              query: "",
              match: SearchAlertMatch.create(1, []),
              searchUrl: "https://example.com/search?make=volvo",
              unsubscribeUrl: "https://example.com/unsubscribe?id=2",
            },
          ],
          alertCount: 2,
          vehicleCount: 2,
        },
        manageSearchesUrl: "https://example.com/settings",
      }),
    );

    expect(html).toContain("Daily Saved Search Update");
    expect(html).toContain("Volvo V8");
    expect(html).toContain("Pre-2000 Volvo");
    expect(html).toContain("https://example.com/unsubscribe?id=1");
    expect(html).toContain("https://example.com/unsubscribe?id=2");
  });

  test("limits vehicle cards across the entire digest", async () => {
    const html = await render(
      NewVehiclesAlert({
        digest: {
          previewAlerts: [
            {
              searchName: "First search",
              query: "volvo",
              match: SearchAlertMatch.create(
                6,
                Array.from({ length: 6 }, (_, index) =>
                  makeVehicle(`first-${index}`),
                ),
              ),
              searchUrl: "https://example.com/search/first",
              unsubscribeUrl: "https://example.com/unsubscribe?id=1",
            },
            {
              searchName: "Second search",
              query: "volvo",
              match: SearchAlertMatch.create(
                6,
                Array.from({ length: 6 }, (_, index) =>
                  makeVehicle(`second-${index}`),
                ),
              ),
              searchUrl: "https://example.com/search/second",
              unsubscribeUrl: "https://example.com/unsubscribe?id=2",
            },
          ],
          alertCount: 2,
          vehicleCount: 12,
        },
        manageSearchesUrl: "https://example.com/settings",
      }),
    );

    expect(html.match(/href="https:\/\/example.com\/vehicles\//g)).toHaveLength(
      10,
    );
    expect(html.match(/1<!-- --> more vehicle/g)).toHaveLength(2);
  });

  test("summarizes saved searches beyond the digest section limit", async () => {
    const html = await render(
      NewVehiclesAlert({
        digest: {
          previewAlerts: Array.from({ length: 10 }, (_, index) => ({
            searchName: `Search ${index}`,
            query: "volvo",
            match: SearchAlertMatch.create(1, [
              makeVehicle(`vehicle-${index}`),
            ]),
            searchUrl: `https://example.com/search/${index}`,
            unsubscribeUrl: `https://example.com/unsubscribe?id=${index}`,
          })),
          alertCount: 12,
          vehicleCount: 12,
        },
        manageSearchesUrl: "https://example.com/settings",
      }),
    );

    expect(
      html.match(/href="https:\/\/example.com\/unsubscribe\?id=/g),
    ).toHaveLength(10);
    expect(html).toContain("2<!-- --> more saved search");
    expect(new TextEncoder().encode(html).length).toBeLessThan(100_000);
  });
});

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  algoliaHitToSearchVehicle,
  SEARCH_CARD_ATTRIBUTES,
  type AlgoliaVehicleHit,
} from "~/lib/search-vehicles";
import { VehicleCard } from "./VehicleCard";

const hit: AlgoliaVehicleHit = {
  source: "pyp",
  objectID: "civic",
  year: 2012,
  make: "Honda",
  model: "Civic",
  vin: "1FADP3F29FL123456",
  stockNumber: "12345",
  locationCode: "1264",
  locationName: "Pick Your Part - Anaheim",
  locationCity: "Anaheim",
  stateAbbr: "CA",
  detailsUrl:
    "https://www.lkqpickyourpart.com/inventory/anaheim-1264/2012-honda-civic/",
};

function card(
  overrides: AlgoliaVehicleHit = {},
  location?: { lat: number; lng: number },
) {
  const vehicle = algoliaHitToSearchVehicle({ ...hit, ...overrides }, location);
  if (!vehicle) throw new Error("Expected supported vehicle source");
  return renderToStaticMarkup(<VehicleCard vehicle={vehicle} />);
}

describe("search card details", () => {
  test("retrieves the details used on cards in the existing search request", () => {
    for (const field of [
      "section",
      "row",
      "space",
      "engine",
      "transmission",
      "trim",
      "sourceModel",
    ] as const) {
      expect([...SEARCH_CARD_ATTRIBUTES]).toContain(field);
    }
  });

  test("shows trim and a differing yard model", () => {
    const html = card({ trim: "EX", sourceModel: "CIVIC EX" });
    expect(html).toContain(">EX</p>");
    expect(html).toContain("Yard model: CIVIC EX");
    expect(card({ sourceModel: "Civic" })).not.toContain("Yard model");
  });

  test("shows section, row and space with engine and transmission", () => {
    const html = card({
      section: " Cars ",
      row: " 13 ",
      space: " 6 ",
      engine: " 2.0L I4 ",
      transmission: " Automatic ",
    });
    expect(html).toContain("Section Cars · Row 13 · Space 6");
    expect(html).toContain("Engine</dt>");
    expect(html).toContain("2.0L I4</dd>");
    expect(html).toContain("Transmission</dt>");
    expect(html).toContain("Automatic</dd>");
  });

  test("shows row alone, including zero, without empty position labels", () => {
    expect(card({ row: "0" })).toContain("Row 0");
    expect(card({ row: "215" })).toContain("Row 215");
    expect(card({ row: "215" })).not.toContain("Section ");
    expect(card({ row: "215" })).not.toContain("Space ");
  });

  test("omits absent and placeholder details", () => {
    const html = card({
      section: " ",
      row: "Unknown",
      space: "N/A",
      engine: " - ",
      transmission: "",
    });
    for (const label of [
      "Section ",
      "Row ",
      "Space ",
      "Engine</dt>",
      "Transmission</dt>",
      "from your location",
    ])
      expect(html).not.toContain(label);
  });

  test("keeps honest arrival labels, yard types and image priority", () => {
    const vehicle = algoliaHitToSearchVehicle({
      ...hit,
      arrivalDate: { kind: "seen", date: "2026-11-18" },
      imageUrl: "https://example.com/civic.jpg",
    });
    if (!vehicle) throw new Error("Expected supported source");
    const html = renderToStaticMarkup(
      <VehicleCard vehicle={vehicle} priority />,
    );
    expect(html).toContain("Seen Nov 18, 2026");
    expect(card()).toContain("Date unknown");
    expect(html).toContain("Yard type: Self-service");
    expect(html).toContain('fetchPriority="high"');
    expect(html).not.toContain('data-slot="card"');
  });

  test("gives the provider link vehicle and new-tab context", () => {
    expect(card()).toContain(
      'aria-label="View inventory for the 2012 Honda Civic (opens in a new tab)"',
    );
  });
});

describe("card miles", () => {
  const origin = { lat: 30, lng: -97 };
  test("computes miles from the user's location on ordinary sorts", () => {
    expect(card({ _geoloc: { lat: 31, lng: -97 } }, origin)).toContain("69 mi");
  });
  test("prefers Algolia meters, including zero, without a known browser location", () => {
    expect(card({ _rankingInfo: { geoDistance: 16093.44 } })).toContain(
      "10 mi",
    );
    expect(card({ _rankingInfo: { geoDistance: 0 } })).toContain("0 mi");
  });
  test("keeps distances below a mile useful", () => {
    expect(card({ _rankingInfo: { geoDistance: 100 } })).toContain("&lt;1 mi");
  });

  test("restores meters from Algolia's geoPrecision distance buckets", () => {
    expect(
      card({ _rankingInfo: { geoDistance: 121746, geoPrecision: 10 } }),
    ).toContain("756 mi");
  });

  test.each([0, -1, NaN, Infinity, "10"])(
    "ignores invalid ranking precision %j",
    (geoPrecision) => {
      expect(
        card(
          {
            _rankingInfo: { geoDistance: 100, geoPrecision },
            _geoloc: { lat: 31, lng: -97 },
          },
          origin,
        ),
      ).toContain("69 mi");
    },
  );
  test.each([
    undefined,
    null,
    { lat: 0, lng: 0 },
    { lat: 91, lng: 0 },
    { lat: 30, lng: Infinity },
  ])(
    "does not present missing or invalid coordinates as zero miles: %j",
    (_geoloc) => {
      expect(card({ _geoloc }, origin)).not.toContain("from your location");
    },
  );
  test.each([-1, NaN, Infinity, "100"])(
    "ignores invalid ranking distance %j and falls back to coordinates",
    (geoDistance) => {
      expect(
        card(
          { _rankingInfo: { geoDistance }, _geoloc: { lat: 31, lng: -97 } },
          origin,
        ),
      ).toContain("69 mi");
    },
  );
  test("does not invent miles without an origin or ranking distance", () => {
    expect(card({ _geoloc: origin })).not.toContain("from your location");
    expect(card({ _geoloc: origin }, origin)).toContain("0 mi");
  });
});

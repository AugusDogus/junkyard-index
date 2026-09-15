import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/upullrparts-vehicle.json";
import { transformUpullRPartsVehicle } from "./upullrparts-transform";
import { findUpullRPartsYard } from "./upullrparts-yard-metadata";

const yard = findUpullRPartsYard(1);
if (!yard) throw new Error("Missing Rosemount fixture yard");

describe("U Pull R Parts transformation", () => {
  test("preserves source model and inventory location without inventing a make or image", () => {
    expect(transformUpullRPartsVehicle(fixture, yard)).toMatchObject({
      vin: "1FADP3F20FL287649",
      source: "upullrparts",
      year: 2015,
      make: "Other",
      model: "FOCUS",
      color: "Black",
      stockNumber: "UG072546",
      availableDate: "2026-09-15T00:00:00.000Z",
      row: "402",
      locationCode: "UPRRP-1",
      locationCity: "Rosemount",
      state: "Minnesota",
      stateAbbr: "MN",
      lat: 44.7183045,
      lng: -93.1261146,
      detailsUrl: "https://upullrparts.com/inventory/",
      imageUrl: null,
    });
  });
  test("normalizes identity and keeps historical short VINs consistent with other connectors", () => {
    expect(
      transformUpullRPartsVehicle(
        { ...fixture, VIN: " 6l4752q422582 ", Color: "Unknown", Row: 0 },
        yard,
      ),
    ).toMatchObject({
      vin: "6L4752Q422582",
      color: null,
      row: "0",
    });
  });
  test.each(["2026-02-30", "invalid", "2026-13-01", "", null])(
    "does not normalize impossible date %s into another day",
    (DateSetData) => {
      expect(
        transformUpullRPartsVehicle({ ...fixture, DateSetData }, yard)
          ?.availableDate,
      ).toBeNull();
    },
  );
  test.each([
    { VIN: " " },
    { Year: null },
    { Year: 0 },
    { Year: 2000.5 },
    { Model: " " },
  ])("rejects records without required vehicle fields: %j", (fields) => {
    expect(
      transformUpullRPartsVehicle({ ...fixture, ...fields }, yard),
    ).toBeNull();
  });
  test("does not fabricate absent coordinates", () => {
    expect(
      transformUpullRPartsVehicle(fixture, { ...yard, lat: null, lng: null }),
    ).toBeNull();
  });
});

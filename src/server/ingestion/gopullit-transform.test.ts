import { describe, expect, test } from "bun:test";
import type { GopullitInventoryRecord } from "./gopullit-client";
import {
  hasGopullitVehicleMetadata,
  resolveGopullitLocation,
  transformGopullitVehicle,
} from "./gopullit-transform";

const completeRecord: GopullitInventoryRecord = {
  id: 333591,
  title: "GPI0331270",
  created_at: "2026-08-18 20:19:59",
  gallery: [
    {
      thumbnail: "https://gopullit.com/car-600x600.jpg",
      full: "https://gopullit.com/car.jpg",
    },
  ],
  location: "107",
  make: "HONDA",
  model: "ACCORD",
  vin: "1HGCP2F79CA059766",
  yardCity: "JACKSONVILLE ",
  yardDate: "08/17/26",
  yardState: "FL",
  year: "2012",
};

describe("GO Pull-It inventory transformation", () => {
  test("maps an AppPresser record to its authoritative yard", () => {
    if (!hasGopullitVehicleMetadata(completeRecord)) {
      throw new Error("GO Pull-It fixture is missing vehicle metadata");
    }
    const location = resolveGopullitLocation(completeRecord);
    if (!location) throw new Error("GO Pull-It fixture yard is unknown");

    expect(transformGopullitVehicle(completeRecord, location)).toMatchObject({
      vin: "1HGCP2F79CA059766",
      source: "gopullit",
      year: 2012,
      make: "Honda",
      model: "ACCORD",
      stockNumber: "GPI0331270",
      imageUrl: "https://gopullit.com/car.jpg",
      availableDate: "2026-08-17T00:00:00.000Z",
      locationCode: "GPI-JAX",
      locationName: "GO Pull-It - Jacksonville",
      locationCity: "Jacksonville",
      state: "Florida",
      stateAbbr: "FL",
      row: "107",
      detailsUrl: "https://gopullit.com/inventory/gpi0331270/",
    });
  });

  test("identifies records awaiting provider metadata", () => {
    expect(
      hasGopullitVehicleMetadata({
        id: 333600,
        title: "203122103578",
        created_at: "2026-08-18 20:20:04",
        gallery: [],
      }),
    ).toBe(false);
  });

  test("rejects complete records from an unknown yard", () => {
    const record = {
      ...completeRecord,
      yardCity: "UNKNOWN",
      yardState: "ZZ",
    };
    if (!hasGopullitVehicleMetadata(record)) {
      throw new Error("GO Pull-It fixture is missing vehicle metadata");
    }

    expect(resolveGopullitLocation(record)).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import type { Location } from "~/lib/types";
import { transformPypVehicle, type PypVehicleJson } from "./pyp-transform";

const mockLocation: Location = {
  locationCode: "1229",
  locationPageURL: "https://www.pyp.com/inventory/sun-valley-1229/",
  name: "Pick Your Part - Sun Valley",
  displayName: "Sun Valley",
  address: "11201 Pendleton St.",
  city: "Sun Valley",
  state: "California",
  stateAbbr: "CA",
  zip: "91352",
  phone: "(800) 962-2277",
  lat: 34.2284,
  lng: -118.3929,
  distance: 0,
  legacyCode: "229",
  primo: "",
  source: "pyp",
  urls: {
    store: "https://www.pyp.com/inventory/sun-valley-1229/",
    interchange: "/parts/sun-valley-1229/",
    inventory: "/inventory/sun-valley-1229/",
    prices: "/prices/sun-valley-1229/",
    directions: "",
    sellACar: "",
    contact: "",
    customerServiceChat: null,
    carbuyChat: null,
    deals: "",
    parts: "/parts/sun-valley-1229/",
  },
};

const locationMap = new Map<string, Location>([["1229", mockLocation]]);

describe("transformPypVehicle", () => {
  test("transforms a complete vehicle correctly", () => {
    const input: PypVehicleJson = {
      YardCode: "1229",
      Section: "Prime",
      Row: "p1",
      SpaceNumber: "2",
      Color: "Blue",
      Year: "2020",
      Make: "HONDA",
      Model: "CIVIC",
      InYardDate: "2026-02-05T14:07:19Z",
      StockNumber: "1229-36026",
      Vin: "2HGFC2F84LH554430",
      Photos: [
        {
          PhotoPath:
            "https://cdn.lkqcorp.com/carbuy/CAR-FRONT-LEFT_24371885.jpg?w=500&h=500",
          IsPrimary: true,
          IsInternal: false,
          InventoryPhoto: false,
        },
      ],
    };

    const result = transformPypVehicle(input, locationMap);

    expect(result).not.toBeNull();
    expect(result?.vin).toBe("2HGFC2F84LH554430");
    expect(result?.source).toBe("pyp");
    expect(result?.year).toBe(2020);
    expect(result?.make).toBe("Honda");
    expect(result?.model).toBe("CIVIC");
    expect(result?.color).toBe("Blue");
    expect(result?.stockNumber).toBe("1229-36026");
    expect(result?.imageUrl).toBe(
      "https://cdn.lkqcorp.com/carbuy/CAR-FRONT-LEFT_24371885.jpg?w=500&h=500",
    );
    expect(result?.availableDate).toBe("2026-02-05T14:07:19.000Z");
    expect(result?.locationName).toBe("Pick Your Part - Sun Valley");
    expect(result?.locationCity).toBe("Sun Valley");
    expect(result?.state).toBe("California");
    expect(result?.stateAbbr).toBe("CA");
    expect(result?.lat).toBe(34.2284);
    expect(result?.lng).toBe(-118.3929);
    expect(result?.section).toBe("Prime");
    expect(result?.row).toBe("p1");
    expect(result?.space).toBe("2");
    expect(result?.detailsUrl).toBe(
      "https://www.pyp.com/inventory/sun-valley-1229/2020-honda-civic/",
    );
    expect(result?.partsUrl).toBe(
      "https://www.pyp.com/parts/sun-valley-1229/?year=2020&make=Honda&model=CIVIC",
    );
    expect(result?.pricesUrl).toBe(
      "https://www.pyp.com/prices/sun-valley-1229/",
    );
  });

  test("returns null for vehicle without VIN", () => {
    const input: PypVehicleJson = {
      YardCode: "1229",
      Section: "Yard",
      Row: "5",
      SpaceNumber: "12",
      Color: "White",
      Year: "2004",
      Make: "TOYOTA",
      Model: "SIENNA",
      InYardDate: "2026-02-20T14:56:16Z",
      StockNumber: "1229-41225",
      Vin: "",
      Photos: [],
    };

    expect(transformPypVehicle(input, locationMap)).toBeNull();
  });

  test("handles missing photos", () => {
    const input: PypVehicleJson = {
      YardCode: "1229",
      Section: "Yard",
      Row: "3",
      SpaceNumber: "7",
      Color: "Red",
      Year: "2015",
      Make: "FORD",
      Model: "FOCUS",
      InYardDate: "2026-01-15T10:00:00Z",
      StockNumber: "1229-12345",
      Vin: "1FADP3F29FL123456",
      Photos: [],
    };

    const result = transformPypVehicle(input, locationMap);
    expect(result).not.toBeNull();
    expect(result?.imageUrl).toBeNull();
  });

  test("handles unknown location code gracefully", () => {
    const input: PypVehicleJson = {
      YardCode: "9999",
      Section: "Yard",
      Row: "1",
      SpaceNumber: "1",
      Color: "Black",
      Year: "2018",
      Make: "CHEVROLET",
      Model: "MALIBU",
      InYardDate: "2026-02-10T08:00:00Z",
      StockNumber: "9999-00001",
      Vin: "1G1ZD5ST8JF100001",
      Photos: [],
    };

    expect(transformPypVehicle(input, locationMap)).toBeNull();
  });

  test("normalizes empty optional fields to null", () => {
    const input: PypVehicleJson = {
      YardCode: "1229",
      Section: "",
      Row: "",
      SpaceNumber: "",
      Color: "",
      Year: "2010",
      Make: "NISSAN",
      Model: "ALTIMA",
      InYardDate: "",
      StockNumber: "",
      Vin: "1N4AL2AP6AN400001",
      Photos: [],
    };

    const result = transformPypVehicle(input, locationMap);
    expect(result).not.toBeNull();
    expect(result?.color).toBeNull();
    expect(result?.stockNumber).toBeNull();
    expect(result?.section).toBeNull();
    expect(result?.row).toBeNull();
    expect(result?.space).toBeNull();
    expect(result?.availableDate).toBeNull();
  });

  test("normalizes make and color casing", () => {
    const input: PypVehicleJson = {
      YardCode: "1229",
      Section: "A",
      Row: "2",
      SpaceNumber: "3",
      Color: "[BLACK]",
      Year: "2011",
      Make: "BMW",
      Model: "328I",
      InYardDate: "2026-01-15T10:00:00Z",
      StockNumber: "1229-99999",
      Vin: "WBAKE5C58BE123456",
      Photos: [],
    };

    const result = transformPypVehicle(input, locationMap);
    expect(result?.make).toBe("BMW");
    expect(result?.color).toBe("Black");
  });
});

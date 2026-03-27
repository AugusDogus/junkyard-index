import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { Row52LocationSchema, transformRow52Vehicle } from "./row52-connector";
import { decodePypFilterResponse } from "./pyp-browser-session";

describe("provider decoder regressions", () => {
  test("accepts null Row52 partsPricingUrl", () => {
    const decodeLocation = Schema.decodeUnknownSync(Row52LocationSchema);

    const location = decodeLocation({
      id: 26,
      accountId: "acct-26",
      name: "Example Yard",
      code: "EX1",
      address1: "123 Main St",
      address2: null,
      city: "Tulsa",
      zipCode: "74101",
      stateId: 1,
      phone: "555-0100",
      hours: "9-5",
      latitude: 36.154,
      longitude: -95.993,
      isActive: true,
      isVisible: true,
      isParticipating: true,
      webUrl: "https://example.com",
      logoUrl: null,
      partsPricingUrl: null,
      state: {
        id: 1,
        name: "Oklahoma",
        abbreviation: "OK",
        countryId: 1,
      },
    });

    expect(location.partsPricingUrl).toBeNull();
  });

  test("accepts null Row52 phone", () => {
    const decodeLocation = Schema.decodeUnknownSync(Row52LocationSchema);

    const location = decodeLocation({
      id: 29,
      accountId: "acct-29",
      name: "Example Yard 29",
      code: "EX29",
      address1: "29 Main St",
      address2: null,
      city: "Tulsa",
      zipCode: "74101",
      stateId: 1,
      phone: null,
      hours: "9-5",
      latitude: 36.154,
      longitude: -95.993,
      isActive: true,
      isVisible: true,
      isParticipating: true,
      webUrl: "https://example.com",
      logoUrl: null,
      partsPricingUrl: null,
      state: {
        id: 1,
        name: "Oklahoma",
        abbreviation: "OK",
        countryId: 1,
      },
    });

    expect(location.phone).toBeNull();
  });

  test("accepts null Row52 webUrl", () => {
    const decodeLocation = Schema.decodeUnknownSync(Row52LocationSchema);

    const location = decodeLocation({
      id: 30,
      accountId: "acct-30",
      name: "Example Yard 30",
      code: "EX30",
      address1: "30 Main St",
      address2: null,
      city: "Tulsa",
      zipCode: "74101",
      stateId: 1,
      phone: null,
      hours: "9-5",
      latitude: 36.154,
      longitude: -95.993,
      isActive: true,
      isVisible: true,
      isParticipating: true,
      webUrl: null,
      logoUrl: null,
      partsPricingUrl: null,
      state: {
        id: 1,
        name: "Oklahoma",
        abbreviation: "OK",
        countryId: 1,
      },
    });

    expect(location.webUrl).toBeNull();
  });

  test("accepts null phone in authoritative Row52 yard search payload", () => {
    const vehicle = {
      id: 1,
      vin: "1FADP3F29FL123456",
      modelId: 10,
      year: 2015,
      locationId: 99,
      row: "A",
      slot: null,
      barCodeNumber: "77-1234",
      dateAdded: "2026-03-27T00:00:00Z",
      creationDate: "2026-03-27T00:00:00Z",
      lastModificationDate: "2026-03-27T00:00:00Z",
      isActive: true,
      isVisible: true,
      defaultImage: 0,
      color: "Blue",
      engine: null,
      trim: null,
      transmission: null,
      model: {
        id: 10,
        name: "Focus",
        makeId: 1,
        make: {
          id: 1,
          name: "Ford",
        },
      },
      images: [],
    };

    const canonical = transformRow52Vehicle(
      vehicle,
      new Map([
        [
          99,
          {
            id: 99,
            accountId: "",
            name: "PICK-n-PULL Kansas City (12th St.)",
            code: "77",
            address1: "1142 South 12th Street",
            address2: null,
            city: "Kansas City",
            zipCode: "66105",
            stateId: 0,
            phone: null,
            hours: "9-5",
            latitude: 39.076076,
            longitude: -94.640999,
            isActive: true,
            isVisible: true,
            isParticipating: true,
            webUrl: "https://picknpull.com/locations/159/detail",
            logoUrl: null,
            partsPricingUrl: "http://www.picknpull.com/part_pricing.aspx?LocationID=159",
            state: {
              id: 0,
              name: "KS",
              abbreviation: "KS",
              countryId: 0,
            },
          },
        ],
      ]),
    );

    expect(canonical).not.toBeNull();
    expect(canonical?.locationCode).toBe("99");
  });

  test("accepts missing PYP SpaceNumber", () => {
    const response = decodePypFilterResponse({
      Success: true,
      Errors: [],
      ResponseData: {
        Request: {
          YardCode: ["1229"],
          Filter: "",
          PageSize: 100,
          PageNumber: 1,
          FilterDeals: false,
        },
        Vehicles: [
          {
            YardCode: "1229",
            Section: "A",
            Row: "1",
            Color: "Blue",
            Year: "2020",
            Make: "HONDA",
            Model: "CIVIC",
            InYardDate: "2026-03-26T00:00:00Z",
            StockNumber: "1229-1",
            Vin: "2HGFC2F84LH554430",
            Photos: [],
          },
        ],
      },
      Messages: [],
    });

    expect(response.ResponseData.Vehicles[0]?.SpaceNumber).toBe("");
  });

  test("accepts missing PYP Section", () => {
    const response = decodePypFilterResponse({
      Success: true,
      Errors: [],
      ResponseData: {
        Request: {
          YardCode: ["1229"],
          Filter: "",
          PageSize: 100,
          PageNumber: 1,
          FilterDeals: false,
        },
        Vehicles: [
          {
            YardCode: "1229",
            Row: "1",
            Color: "Blue",
            Year: "2020",
            Make: "HONDA",
            Model: "CIVIC",
            InYardDate: "2026-03-26T00:00:00Z",
            StockNumber: "1229-1",
            Vin: "2HGFC2F84LH554430",
            Photos: [],
          },
        ],
      },
      Messages: [],
    });

    expect(response.ResponseData.Vehicles[0]?.Section).toBe("");
  });

  test("accepts missing PYP Row", () => {
    const response = decodePypFilterResponse({
      Success: true,
      Errors: [],
      ResponseData: {
        Request: {
          YardCode: ["1229"],
          Filter: "",
          PageSize: 100,
          PageNumber: 1,
          FilterDeals: false,
        },
        Vehicles: [
          {
            YardCode: "1229",
            Section: "A",
            Color: "Blue",
            Year: "2020",
            Make: "HONDA",
            Model: "CIVIC",
            InYardDate: "2026-03-26T00:00:00Z",
            StockNumber: "1229-1",
            Vin: "2HGFC2F84LH554430",
            Photos: [],
          },
        ],
      },
      Messages: [],
    });

    expect(response.ResponseData.Vehicles[0]?.Row).toBe("");
  });

  test("accepts null PYP Color", () => {
    const response = decodePypFilterResponse({
      Success: true,
      Errors: [],
      ResponseData: {
        Request: {
          YardCode: ["1185"],
          Filter: "",
          PageSize: 500,
          PageNumber: 78,
          FilterDeals: false,
        },
        Vehicles: [
          {
            YardCode: "1185",
            Section: "4B",
            Row: "81",
            SpaceNumber: "13",
            Color: null,
            Year: "2003",
            Make: "PONTIAC",
            Model: "VIBE",
            InYardDate: "2026-03-18T00:00:00",
            StockNumber: "1185-47756",
            Vin: "5Y2SL64863Z462470",
            Photos: [],
          },
        ],
      },
      Messages: [],
    });

    expect(response.ResponseData.Vehicles[0]?.Color).toBe("");
  });
});

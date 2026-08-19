import { describe, expect, test } from "bun:test";
import { transformUpullitDavieVehicle } from "./upullit-davie-transform";

describe("transformUpullitDavieVehicle", () => {
  test("maps a provider vehicle to the Davie yard", () => {
    const result = transformUpullitDavieVehicle({
      id: "cmt048now6wewta01hzk9mmhr",
      stockNumber: "U028341",
      vin: "JHLRD28411C005225",
      year: 2001,
      make: "HONDA",
      model: "CR-V",
      trim: null,
      color: null,
      engine: null,
      transmission: null,
      dateArrived: "2026-08-19T09:13:47.077Z",
      row: "96",
      space: null,
      imageUrl:
        "https://upullitdavie.com/wp-content/uploads/photos/JHLRD28411C005225-01.webp",
    });

    expect(result).toMatchObject({
      vin: "JHLRD28411C005225",
      source: "upullitdavie",
      year: 2001,
      make: "Honda",
      model: "CR-V",
      stockNumber: "U028341",
      availableDate: "2026-08-19T09:13:47.077Z",
      locationCode: "UPULLIT-DAVIE",
      locationName: "U Pull It Davie",
      locationCity: "Davie",
      state: "Florida",
      stateAbbr: "FL",
      row: "96",
    });
    expect(result?.detailsUrl).toBe(
      "https://upullitdavie.com/inventory?q=JHLRD28411C005225",
    );
  });

  test("rejects records without a usable VIN", () => {
    expect(
      transformUpullitDavieVehicle({
        id: "provider-id",
        stockNumber: "U028341",
        vin: " ",
        year: 2001,
        make: "HONDA",
        model: "CR-V",
        trim: null,
        color: null,
        engine: null,
        transmission: null,
        dateArrived: "2026-08-19T09:13:47.077Z",
        row: "96",
        space: null,
        imageUrl: null,
      }),
    ).toBeNull();
  });
});

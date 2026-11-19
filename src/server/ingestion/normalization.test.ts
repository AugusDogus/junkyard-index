import { describe, expect, test } from "bun:test";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
  normalizeCanonicalEngine,
  normalizeCanonicalVehicle,
  normalizeRegion,
} from "./normalization";
import { makeVehicle } from "./durable-ingestion-test-fixtures";

test("normalizes new ingestion without inventing years or arrival dates", () => {
  expect(
    normalizeCanonicalVehicle({
      ...makeVehicle(),
      source: "row52",
      make: "Nissian",
      model: "NISSIAN SENTRA",
      engine: "1.589545208L",
      locationName: "KIKER'S U PULL IT",
    }),
  ).toMatchObject({
    make: "Nissan",
    model: "SENTRA",
    engine: "1.6L",
    locationName: "Kiker's U Pull It",
  });
  expect(
    normalizeCanonicalVehicle({
      ...makeVehicle(),
      year: 1990,
      make: "Toyota",
      model: "TOYOTA TACOMA",
      availableDate: "2014-02-01",
    }),
  ).toMatchObject({ year: 1990, model: "TACOMA", availableDate: "2014-02-01" });
});

test.each([
  ["1.589545208L", "1.6L"],
  ["2.000000L", "2.0L"],
  ["1.589545208", "1.589545208"],
  ["2.0L I4", "2.0L I4"],
  ["1590cc", "1590cc"],
  [null, null],
  ["", null],
])("rounds only explicit numeric liter displacement: %s", (raw, expected) => {
  expect(normalizeCanonicalEngine(raw)).toBe(expected);
});

describe("normalization helpers", () => {
  test("normalizes make casing and preserves known acronyms", () => {
    expect(normalizeCanonicalMake("HONDA")).toBe("Honda");
    expect(normalizeCanonicalMake("Jeep")).toBe("Jeep");
    expect(normalizeCanonicalMake("BMW")).toBe("BMW");
    expect(normalizeCanonicalMake("mercedes benz")).toBe("Mercedes-Benz");
    expect(normalizeCanonicalMake("ROLLS-ROYCE")).toBe("Rolls-Royce");
    expect(normalizeCanonicalMake("1963")).toBe("Other");
  });

  test("normalizes color casing and aliases", () => {
    expect(normalizeCanonicalColor("BLACK")).toBe("Black");
    expect(normalizeCanonicalColor("[WHITE]")).toBe("White");
    expect(normalizeCanonicalColor("GREY/SILVER")).toBe("Silver");
    expect(normalizeCanonicalColor("UNKNOWN")).toBeNull();
    expect(normalizeCanonicalColor("Other")).toBeNull();
  });

  test("normalizes region names and abbreviations", () => {
    expect(normalizeRegion("CA")).toEqual({
      state: "California",
      stateAbbr: "CA",
    });
    expect(normalizeRegion("California", null)).toEqual({
      state: "California",
      stateAbbr: "CA",
    });
    expect(normalizeRegion("British Columbia", null)).toEqual({
      state: "British Columbia",
      stateAbbr: "BC",
    });
    expect(normalizeRegion("", null)).toEqual({
      state: "Unknown",
      stateAbbr: "",
    });
    expect(normalizeRegion("", "")).toEqual({
      state: "Unknown",
      stateAbbr: "",
    });
  });
});

import { describe, expect, test } from "bun:test";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
  normalizeRegion,
} from "./normalization";

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

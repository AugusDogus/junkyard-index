import { describe, expect, test } from "bun:test";
import { VinPattern } from "~/lib/vin-pattern";

describe("VinPattern", () => {
  test("builds position filters for literals and wildcards", () => {
    const result = VinPattern.parse("YV4C*85**********");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(VinPattern.toAlgoliaFilter(result.data)).toBe(
      'vinPositionTokens:"0:Y" AND vinPositionTokens:"1:V" AND vinPositionTokens:"2:4" AND vinPositionTokens:"3:C" AND vinPositionTokens:"5:8" AND vinPositionTokens:"6:5"',
    );
  });

  test("expands character sets and ranges at one VIN position", () => {
    const result = VinPattern.parse("YV4C[0-2][AB]5**********");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.positions[4]).toEqual(["0", "1", "2"]);
    expect(result.data.positions[5]).toEqual(["A", "B"]);
    expect(VinPattern.toAlgoliaFilter(result.data)).toContain(
      '(vinPositionTokens:"4:0" OR vinPositionTokens:"4:1" OR vinPositionTokens:"4:2")',
    );
  });

  test("rejects patterns that do not describe 17 positions", () => {
    const result = VinPattern.parse("YV4C*85");

    expect(result).toEqual({
      success: false,
      error: { type: "wrong_length", positions: 7 },
    });
  });

  test("rejects invalid VIN characters and descending ranges", () => {
    expect(VinPattern.parse("YV4I*85**********")).toEqual({
      success: false,
      error: { type: "invalid_character", character: "I" },
    });
    expect(VinPattern.parse("YV4C[9-0]5**********").success).toBe(false);
  });

  test("creates stable index tokens", () => {
    expect(VinPattern.toIndexTokens("yv4c85")).toEqual([
      "0:Y",
      "1:V",
      "2:4",
      "3:C",
      "4:8",
      "5:5",
    ]);
  });
});

import { describe, expect, test } from "bun:test";
import { buildSearchUrl } from "~/lib/search-utils";

describe("buildSearchUrl", () => {
  test("uses q for ordinary text searches", () => {
    expect(buildSearchUrl("Volvo XC90", {})).toBe("/search?q=Volvo+XC90");
  });

  test("uses q for VIN pattern searches", () => {
    expect(
      buildSearchUrl(null, {
        vinPattern: "YV4C*85**********",
        states: ["California"],
      }),
    ).toBe("/search?q=YV4C*85**********&states=California");
  });
});

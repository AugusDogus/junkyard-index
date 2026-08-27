import { describe, expect, test } from "bun:test";
import { buildSavedSearchEditUrl, buildSearchUrl } from "~/lib/search-utils";

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

describe("buildSavedSearchEditUrl", () => {
  test("loads the search filters and identifies the saved search being edited", () => {
    expect(
      buildSavedSearchEditUrl("search-1", "Civic", {
        makes: ["Honda"],
        minYear: 2008,
      }),
    ).toBe("/search?q=Civic&makes=Honda&minYear=2008&editSearch=search-1");
  });
});

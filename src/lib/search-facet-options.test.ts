import { describe, expect, test } from "bun:test";
import { mapSearchFacetOptions } from "./search-facet-options";

describe("mapSearchFacetOptions", () => {
  test("maps and alphabetizes supported Algolia facets", () => {
    expect(
      mapSearchFacetOptions({
        make: { Toyota: 20, Honda: 10 },
        color: { White: 8, Black: 12 },
        state: { Texas: 15, California: 5 },
        locationName: { "Yard Two": 4, "Yard One": 6 },
      }),
    ).toEqual({
      makes: ["Honda", "Toyota"],
      colors: ["Black", "White"],
      states: ["California", "Texas"],
      salvageYards: ["Yard One", "Yard Two"],
    });
  });

  test("returns empty choices for missing or malformed facets", () => {
    expect(
      mapSearchFacetOptions({
        make: null,
        color: [],
        state: "Texas",
      }),
    ).toEqual({
      makes: [],
      colors: [],
      states: [],
      salvageYards: [],
    });
  });
});

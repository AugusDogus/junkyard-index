import { describe, expect, test } from "bun:test";
import {
  buildAdvancedSearchQuery,
  hasAdvancedSearchSyntax,
  parseAdvancedSearchQuery,
} from "./advanced-search-query";

describe("advanced search query", () => {
  test("builds the readable power-user syntax from form fields", () => {
    expect(
      buildAdvancedSearchQuery({
        allWords: "  pickup   truck ",
        exactPhrase: '"crew cab"',
        anyWords: "Ford, Chevrolet, Ram",
        excludedWords: "diesel damaged",
      }),
    ).toBe(
      'pickup truck "crew cab" (Ford OR Chevrolet OR Ram) !diesel !damaged',
    );
  });

  test("translates OR, exact phrases, and exclusions for Algolia", () => {
    expect(
      parseAdvancedSearchQuery(
        'pickup (Ford OR Chevrolet OR Ram) "crew cab" !diesel',
      ),
    ).toEqual({
      success: true,
      data: {
        algoliaQuery: 'pickup Ford Chevrolet Ram "crew cab" -diesel',
        optionalWords: ["Ford", "Chevrolet", "Ram"],
      },
    });
  });

  test("keeps ordinary search text unchanged", () => {
    expect(parseAdvancedSearchQuery("2020 Toyota Tacoma")).toEqual({
      success: true,
      data: {
        algoliaQuery: "2020 Toyota Tacoma",
        optionalWords: [],
      },
    });
    expect(hasAdvancedSearchSyntax("2020 Toyota Tacoma")).toBe(false);
    expect(hasAdvancedSearchSyntax("Toyota OR Honda !damaged")).toBe(true);
  });

  test("rejects incomplete Boolean expressions", () => {
    expect(parseAdvancedSearchQuery("Honda OR")).toEqual({
      success: false,
      error: "Put a search term on both sides of OR.",
    });
    expect(parseAdvancedSearchQuery('"Honda Civic')).toEqual({
      success: false,
      error: "Close the quoted phrase before searching.",
    });
  });
});

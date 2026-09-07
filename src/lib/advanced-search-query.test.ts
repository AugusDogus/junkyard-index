import { describe, expect, test } from "bun:test";
import {
  getAdvancedSearchQueryFields,
  buildAdvancedSearchFilters,
  buildAdvancedSearchQuery,
  buildAdvancedSearchTokens,
  hasAdvancedSearchSyntax,
  parseAdvancedSearchQuery,
} from "./advanced-search-query";

describe("advanced search query", () => {
  test("restores guided fields when reopening a saved Boolean query", () => {
    const fields = {
      allWords: "pickup truck",
      exactPhrase: "crew cab",
      anyWords: "Ford, Chevrolet, Ram",
      excludedWords: "diesel, damaged",
    };
    expect(
      getAdvancedSearchQueryFields(buildAdvancedSearchQuery(fields)),
    ).toEqual(fields);
  });

  test("keeps queries the guided fields cannot express in syntax mode", () => {
    for (const query of [
      "(Ford OR Ram) (diesel OR gasoline)",
      '"crew cab" "long bed"',
      '!"crew cab"',
      '(chev"rolet OR Ford)',
      '("Land Rover" OR Volvo)',
      '"unfinished',
    ]) {
      expect(getAdvancedSearchQueryFields(query)).toBeNull();
    }
  });

  test("restores ordinary and empty searches without adding syntax", () => {
    expect(getAdvancedSearchQueryFields("volvo wagon")?.allWords).toBe(
      "volvo wagon",
    );
    expect(getAdvancedSearchQueryFields("")?.allWords).toBe("");
  });

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
        algoliaQuery: 'pickup "crew cab" -diesel',
        anyWordGroups: [["ford", "chevrolet", "ram"]],
      },
    });

    expect(parseAdvancedSearchQuery("Honda OR Toyota !damaged")).toEqual({
      success: true,
      data: {
        algoliaQuery: "-damaged",
        anyWordGroups: [["honda", "toyota"]],
      },
    });
  });

  test("compiles OR groups into required Algolia token filters", () => {
    expect(
      buildAdvancedSearchFilters(
        [
          ["ford", "ram"],
          ["crew cab", 'say "hello"'],
        ],
        'state:"Texas"',
      ),
    ).toBe(
      '(state:"Texas") AND (searchTokens:"ford" OR searchTokens:"ram") AND (searchTokens:"crew cab" OR searchTokens:"say \\"hello\\"")',
    );
  });

  test("builds normalized filter tokens from searchable vehicle fields", () => {
    expect(
      buildAdvancedSearchTokens([
        "Mercedes-Benz",
        "Land Rover",
        2020,
        null,
        "1ABC",
      ]),
    ).toEqual([
      "mercedes-benz",
      "mercedes",
      "benz",
      "land rover",
      "land",
      "rover",
      "2020",
      "1abc",
    ]);
  });

  test("keeps ordinary search text unchanged", () => {
    expect(parseAdvancedSearchQuery("2020 Toyota Tacoma")).toEqual({
      success: true,
      data: {
        algoliaQuery: "2020 Toyota Tacoma",
        anyWordGroups: [],
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

import { describe, expect, mock, test } from "bun:test";
import { InventoryFilterOptions } from "./inventory-filter-options";

describe("inventory filter options", () => {
  test("loads options independently of the current query and refinements", async () => {
    const search = mock(async () => ({
      results: [
        {
          hits: [],
          nbHits: 3,
          page: 0,
          nbPages: 0,
          hitsPerPage: 0,
          processingTimeMS: 1,
          query: "",
          params: "",
          facets: {
            make: { Honda: 1, Ford: 2 },
            color: { Red: 1, Blue: 2 },
            state: { NE: 2, IA: 1 },
            locationName: { Omaha: 2, Lincoln: 1 },
          },
        },
      ],
    }));

    expect(await InventoryFilterOptions.load({ search })).toEqual({
      makes: ["Ford", "Honda"],
      colors: ["Blue", "Red"],
      states: ["IA", "NE"],
      salvageYards: ["Lincoln", "Omaha"],
    });
    expect(search).toHaveBeenCalledWith({
      requests: [
        {
          indexName: "vehicles",
          query: "",
          facets: ["make", "color", "state", "locationName"],
          maxValuesPerFacet: 1000,
          hitsPerPage: 0,
          analytics: false,
          clickAnalytics: false,
          enableRules: false,
        },
      ],
    });
  });

  test("keeps saved selections that are no longer in inventory", () => {
    const options = {
      makes: ["Ford", "Honda"],
      colors: ["Blue"],
      states: ["NE"],
      salvageYards: ["Omaha"],
    };
    const selected = {
      makes: ["Saab", "Ford"],
      colors: ["Red"],
      states: ["IA"],
      salvageYards: ["Lincoln"],
    };
    expect(InventoryFilterOptions.withSelected(options, selected)).toEqual({
      makes: ["Ford", "Honda", "Saab"],
      colors: ["Blue", "Red"],
      states: ["IA", "NE"],
      salvageYards: ["Lincoln", "Omaha"],
    });
    expect(options.makes).toEqual(["Ford", "Honda"]);
    expect(InventoryFilterOptions.withSelected(undefined, selected)).toEqual({
      ...selected,
      makes: ["Ford", "Saab"],
    });
  });

  test("propagates loading failures so the builder can offer a retry", async () => {
    const failure = new Error("Search unavailable");
    const search = mock(async () => {
      throw failure;
    });
    await expect(InventoryFilterOptions.load({ search })).rejects.toBe(failure);
  });

  test("handles empty inventory without removing saved selections", async () => {
    const search = mock(async () => ({
      results: [
        { hits: [], nbHits: 0, processingTimeMS: 0, query: "", params: "" },
      ],
    }));
    const selected = {
      makes: ["Saab"],
      colors: ["Red"],
      states: ["NE"],
      salvageYards: ["Omaha"],
    };
    const options = await InventoryFilterOptions.load({ search });
    expect(options).toEqual({
      makes: [],
      colors: [],
      states: [],
      salvageYards: [],
    });
    expect(InventoryFilterOptions.withSelected(options, selected)).toEqual(
      selected,
    );
  });
});

import { describe, expect, test } from "bun:test";
import { SearchCriteria } from "./search-criteria";
import { savedSearchMatchCriteriaKey } from "./saved-search-filters";

describe("shared search criteria", () => {
  test("preserves saved Boolean criteria and future-inventory values on a rename", () => {
    const query = '(Ford OR Ram) "crew cab" !diesel';
    const filters = {
      makes: ["Saab"],
      colors: ["Purple"],
      minYear: 1980,
      maxYear: 1990,
      sortBy: "vehicles_oldest",
    };
    const draft = SearchCriteria.fromSavedSearch(query, filters);
    expect(draft.sortBy).toBe("oldest");
    const saved = SearchCriteria.toSavedSearch(draft);
    expect(saved.success).toBe(true);
    if (!saved.success) return;
    expect(
      savedSearchMatchCriteriaKey(saved.data.query, saved.data.filters),
    ).toBe(savedSearchMatchCriteriaKey(query, filters));
  });

  test("allows criteria without keywords and keeps VIN patterns out of the text query", () => {
    const filters = { states: ["Texas"], makes: ["Saab"] };
    const filterOnly = SearchCriteria.toSavedSearch(
      SearchCriteria.fromSavedSearch("", filters),
    );
    expect(filterOnly).toMatchObject({
      success: true,
      data: { query: "", filters },
    });
    const vin = "YV4C*85**********";
    expect(
      SearchCriteria.toSavedSearch(
        SearchCriteria.fromSavedSearch("", { vinPattern: vin }),
      ),
    ).toMatchObject({
      success: true,
      data: { query: "", filters: { vinPattern: vin } },
    });
  });

  test("rejects broken advanced syntax and VIN patterns before saving", () => {
    for (const query of ["Ford OR", '"crew cab', "YV4C*85"]) {
      expect(
        SearchCriteria.toSavedSearch(SearchCriteria.fromSavedSearch(query, {}))
          .success,
      ).toBe(false);
    }
  });
});

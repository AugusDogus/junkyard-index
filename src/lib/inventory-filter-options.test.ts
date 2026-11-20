import { describe, expect, test } from "bun:test";
import { InventoryFilterOptions } from "./inventory-filter-options";

describe("inventory filter options", () => {
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

  test("keeps saved selections when inventory has no options", () => {
    const selected = {
      makes: ["Saab"],
      colors: ["Red"],
      states: ["NE"],
      salvageYards: ["Omaha"],
    };
    expect(
      InventoryFilterOptions.withSelected(
        { makes: [], colors: [], states: [], salvageYards: [] },
        selected,
      ),
    ).toEqual(selected);
  });
});

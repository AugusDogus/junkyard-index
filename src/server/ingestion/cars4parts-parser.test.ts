import { describe, expect, test } from "bun:test";
import {
  parseCars4PartsInventory,
  parseCars4PartsLeaf,
  parseCars4PartsResults,
} from "./cars4parts-parser";
import { cars4partsFixture } from "./cars4parts-test-fixtures";
import { transformCars4PartsRecord } from "./cars4parts-transform";

const inventory = cars4partsFixture("inventory");
const makes = () => {
  const result = parseCars4PartsInventory(inventory);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.makes;
};
const leaf = (name: string, destination: string) => {
  const result = parseCars4PartsLeaf(cars4partsFixture(name), destination);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const location = {
  code: "heyworth",
  name: "Carz R Us 1",
  city: "Heyworth",
  lat: 40.312453,
  lng: -88.9935285,
};

describe("Cars4Parts saved native parsing", () => {
  test("preserves and rejects contradictory explicit native model claims without correction", () => {
    const record = leaf(
      "cadillac-ext",
      "https://cars4parts.carzrus1.com/inventory/parting-out-2005-cadillac-escalade-ext-4wd/",
    );
    const result = transformCars4PartsRecord(record, makes(), location);
    expect(result.status).toBe("rejected");
    expect(result.model).toBe("Esclade EXT");
    expect(result.reasons).toContain("conflicting-native-model");
    expect(result.validVinClaims).toEqual(["3GYEK62N85G212010"]);
    expect(record.proseFields.model).toContain("Escalade");
    expect(record.stock).toEqual(expect.arrayContaining(["H2880C", "P2880C"]));
  });

  test("quarantines every valid VIN when labelled prose contradicts both structured regions", () => {
    const record = leaf(
      "aspen",
      "https://cars4parts.carzrus1.com/inventory/for-parts-repairs-07-chrysler-aspen-runs-1495/",
    );
    const result = transformCars4PartsRecord(record, makes(), location);
    expect(result.status).toBe("rejected");
    expect(result.validVinClaims).toEqual([
      "1A8HW58237F576024",
      "2G1WG5E38C1291483",
    ]);
    expect(result.reasons).toContain("conflicting-native-vin");
  });

  test("accepts vehicle-for-parts prose without a literal Parting Out gate", () => {
    const record = leaf(
      "mazda3",
      "https://cars4parts.carzrus1.com/inventory/mazda3/",
    );
    const result = transformCars4PartsRecord(record, makes(), location);
    expect(result.status).toBe("available");
  });

  test("reads the full published pager and every native result destination", () => {
    const result = parseCars4PartsResults(
      cars4partsFixture("results-page1"),
      1,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.pages).toEqual([1, 2, 3, 4]);
    expect(result.value.rows).toHaveLength(20);
    expect(result.value.rows[0]).toMatchObject({
      destination: "https://cars4parts.carzrus1.com/inventory/cruze/",
      branch: "Heyworth IL, Ph: 309-220-8410",
      ymm: "2012 Chevrolet Cruze",
    });
  });
  test("holds truncated native documents and changed or unclassified continuation controls", () => {
    expect(
      parseCars4PartsInventory(inventory.replace(/<\/html>/i, "")).ok,
    ).toBe(false);
    const raw = cars4partsFixture("results-page1");
    expect(
      parseCars4PartsResults(raw.replace("page-4/", "page-5/"), 1).ok,
    ).toBe(false);
    expect(
      parseCars4PartsResults(
        raw + '<button data-next-page="2">Load More</button>',
        1,
      ).ok,
    ).toBe(false);
  });
});

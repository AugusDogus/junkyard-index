import { describe, expect, it } from "bun:test";
import {
  ADVANCED_SEARCH_SCHEMA_VERSION,
  getSearchSchemaVersion,
  isAdvancedSearchReady,
  isVinPatternSearchReady,
  VIN_PATTERN_SEARCH_SCHEMA_VERSION,
  withSearchSchemaVersion,
} from "../search-index-schema";

describe("search index schema", () => {
  it("treats missing or invalid metadata as version zero", () => {
    expect(getSearchSchemaVersion(undefined)).toBe(0);
    expect(getSearchSchemaVersion({ searchSchemaVersion: "2" })).toBe(0);
    expect(getSearchSchemaVersion({ searchSchemaVersion: -1 })).toBe(0);
  });

  it("reports VIN pattern search ready at schema version three", () => {
    expect(isVinPatternSearchReady({ searchSchemaVersion: 1 })).toBe(false);
    expect(
      isVinPatternSearchReady({
        searchSchemaVersion: VIN_PATTERN_SEARCH_SCHEMA_VERSION,
      }),
    ).toBe(true);
  });

  it("reports Boolean OR search ready only at schema version four", () => {
    expect(
      isAdvancedSearchReady({
        searchSchemaVersion: VIN_PATTERN_SEARCH_SCHEMA_VERSION,
      }),
    ).toBe(false);
    expect(
      isAdvancedSearchReady({
        searchSchemaVersion: ADVANCED_SEARCH_SCHEMA_VERSION,
      }),
    ).toBe(true);
  });

  it("preserves compatible index metadata when advancing the version", () => {
    expect(
      withSearchSchemaVersion(
        { owner: "junkyard-index", searchSchemaVersion: 1 },
        2,
      ),
    ).toEqual({
      success: true,
      data: { owner: "junkyard-index", searchSchemaVersion: 2 },
    });
  });

  it("refuses to overwrite incompatible index metadata", () => {
    expect(withSearchSchemaVersion(["existing"], 2)).toEqual({
      success: false,
      error: "incompatible_user_data",
    });
  });
});

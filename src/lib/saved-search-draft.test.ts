import { describe, expect, test } from "bun:test";
import {
  savedSearchDraft,
  serializeSavedSearchDraft,
} from "./saved-search-draft";
import { SEARCHABLE_VEHICLE_YEAR_RANGE } from "./saved-search-filters";

describe("saved search year bounds", () => {
  const { min, max } = SEARCHABLE_VEHICLE_YEAR_RANGE;
  for (const filters of [{}, { minYear: min, maxYear: max }]) {
    test(`omits the full default range ${JSON.stringify(filters)}`, () => {
      const saved = serializeSavedSearchDraft(
        savedSearchDraft({
          id: "new",
          name: "Saab",
          query: "Saab",
          filters,
          emailAlertsEnabled: false,
          discordAlertsEnabled: false,
        }),
      );
      expect(saved.success).toBe(true);
      if (!saved.success) return;
      expect(saved.data.filters.minYear).toBeUndefined();
      expect(saved.data.filters.maxYear).toBeUndefined();
      expect(saved.data.query).toBe("Saab");
    });
  }
  for (const filters of [
    { minYear: 1980, maxYear: 2000 },
    { minYear: min, maxYear: 2000 },
    { minYear: 1980, maxYear: max },
  ]) {
    test(`preserves a deliberately narrowed year range ${JSON.stringify(filters)}`, () => {
      const saved = serializeSavedSearchDraft(
        savedSearchDraft({
          id: "new",
          name: "Saab",
          query: "Saab",
          filters,
          emailAlertsEnabled: false,
          discordAlertsEnabled: false,
        }),
      );
      expect(saved).toMatchObject({
        success: true,
        data: { filters },
      });
    });
  }
});

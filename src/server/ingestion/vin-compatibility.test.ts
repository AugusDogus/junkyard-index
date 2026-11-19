import { expect, test } from "bun:test";
import { parseSavedSearchFilters } from "~/lib/saved-search-filters";
import { buildAdvancedSearchFilters } from "~/lib/advanced-search-query";
import { compileSearchExpression } from "~/lib/compile-search-expression";
import { COMMON_ALGOLIA_INDEX_SETTINGS } from "./algolia-settings-plan";
import { canonicalizeVinVehicles } from "./vin-canonicalization";
import { makeVehicle } from "./durable-ingestion-test-fixtures";
import { toAlgoliaRecord } from "./types";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { RECONCILIATION_TEST_SCHEMA } from "./durable-reconciliation-test-fixtures";
import { getAlertMatchStatsWithClient } from "~/lib/alert-match-search";

for (const [make, sourceModel, model, series] of [
  ["Chevrolet", "SILVRDO15", "Silverado", "1500"],
  ["Ford", "F150NEW", "F-150", ""],
] as const)
  test(`saved search and alert for ${sourceModel} still match after canonicalization`, async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
      const source = {
        ...makeVehicle("1FTPW14506KD19655"),
        year: 2006,
        make,
        model: sourceModel,
      };
      const [canonical] = await canonicalizeVinVehicles(
        drizzle(client),
        [source],
        {
          decode: async (requests) =>
            new Map(
              requests.map((row) => [
                row.key,
                { make, model, series, year: 2006, trim: null },
              ]),
            ),
        },
      );
      if (!canonical) throw new Error("Missing canonical vehicle");
      const record = toAlgoliaRecord(canonical, new Date(1000), null, 0, null);
      const saved = parseSavedSearchFilters(JSON.stringify({ makes: [make] }));
      if (!saved.success) throw new Error("Invalid saved filters");
      expect(record.model).toBe(make === "Ford" ? "F-150" : "Silverado 1500");
      expect(record.searchTokens).toContain(sourceModel.toLowerCase());
      expect(COMMON_ALGOLIA_INDEX_SETTINGS.searchableAttributes).toContain(
        "unordered(sourceModel)",
      );
      expect(buildAdvancedSearchFilters([[sourceModel]])).toBe(
        `(searchTokens:"${sourceModel.toLowerCase()}")`,
      );
      expect(
        compileSearchExpression(`(${sourceModel} OR other)`),
      ).toMatchObject({
        success: true,
        data: {
          filters: `(searchTokens:"${sourceModel.toLowerCase()}" OR searchTokens:"other")`,
        },
      });
      const alerts = await getAlertMatchStatsWithClient(
        {
          searchForHits: async ({ requests }) => {
            expect(requests[0]?.query).toBe(sourceModel);
            // Replay the index's exact searchable source label, not a live API call.
            const matches = record.sourceModel === requests[0]?.query;
            return {
              results: [
                {
                  hits: matches ? [record] : [],
                  nbHits: matches ? 1 : 0,
                  nbPages: 1,
                  page: 0,
                  hitsPerPage: 100,
                  processingTimeMS: 0,
                  query: sourceModel,
                  params: "",
                  exhaustiveNbHits: true,
                },
              ],
            };
          },
        },
        sourceModel,
        saved.data,
        null,
      );
      expect(alerts.matchedCount).toBe(1);
      expect(alerts.vehicles[0]?.model).toBe(record.model);
    } finally {
      client.close();
    }
  });

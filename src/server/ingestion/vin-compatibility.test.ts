import { warmVinDecodeCache } from "./vin-cache-warmer";
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
      const database = drizzle(client);
      await warmVinDecodeCache(database, [source], {
        decode: async (requests) => ({
          status: "complete",
          decodes: new Map(
            requests.map((row) => [
              row.key,
              { make, model, series, year: 2006, trim: null },
            ]),
          ),
        }),
      });
      const [canonical] = await canonicalizeVinVehicles(database, [source]);
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

test("saved make refinements and alerts retain Chevrolet SONOMA after correction to GMC", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
    const database = drizzle(client);
    const source = {
      ...makeVehicle("1FTPW14506KD19655"),
      year: 2006,
      make: "Chevrolet",
      model: "SONOMA",
    };
    await warmVinDecodeCache(database, [source], {
      decode: async (requests) => ({
        status: "complete",
        decodes: new Map(
          requests.map((row) => [
            row.key,
            { make: "GMC", model: "Sonoma", year: 2006, trim: null },
          ]),
        ),
      }),
    });
    const [canonical] = await canonicalizeVinVehicles(database, [source]);
    if (!canonical) throw new Error("Missing canonical vehicle");
    const record = toAlgoliaRecord(canonical, new Date(1000), null, 0, null);
    expect(record.make).toBe("GMC");
    expect(record.makeAliases).toEqual(["GMC", "Chevrolet"]);
    expect(COMMON_ALGOLIA_INDEX_SETTINGS.attributesForFaceting).toContain(
      "filterOnly(makeAliases)",
    );
    expect(COMMON_ALGOLIA_INDEX_SETTINGS.searchableAttributes).toContain(
      "unordered(makeAliases)",
    );
    const parsed = parseSavedSearchFilters(
      JSON.stringify({ makes: ["Chevrolet"] }),
    );
    if (!parsed.success) throw new Error("Invalid saved make filter");
    const { MakeFilter } = await import("~/lib/make-filter");
    expect(MakeFilter.facets(["make:Chevrolet"])).toEqual([
      "makeAliases:Chevrolet",
    ]);
    expect(compileSearchExpression("make:Chevrolet SONOMA")).toMatchObject({
      success: true,
      data: { filters: 'makeAliases:"Chevrolet"', query: "SONOMA" },
    });
    for (const criteria of [
      parsed.data,
      { expression: "make:Chevrolet SONOMA" },
    ]) {
      const alert = await getAlertMatchStatsWithClient(
        {
          searchForHits: async ({ requests }) => {
            const request = requests[0];
            expect(request?.filters).toBe('makeAliases:"Chevrolet"');
            expect(request?.query).toBe("SONOMA");
            const hits = record.makeAliases.includes("Chevrolet")
              ? [record]
              : [];
            return {
              results: [
                {
                  hits,
                  nbHits: hits.length,
                  nbPages: 1,
                  page: 0,
                  hitsPerPage: 100,
                  processingTimeMS: 0,
                  query: "SONOMA",
                  params: "",
                  exhaustiveNbHits: true,
                },
              ],
            };
          },
        },
        "SONOMA",
        criteria,
        null,
      );
      expect(alert.matchedCount).toBe(1);
      expect(alert.vehicles[0]?.make).toBe("GMC");
    }
    // A correctly sourced GMC truck gains no Chevrolet compatibility match.
    expect(
      toAlgoliaRecord(
        { ...source, make: "GMC", sourceMake: "GMC" },
        new Date(),
        null,
        0,
        null,
      ).makeAliases,
    ).not.toContain("Chevrolet");
  } finally {
    client.close();
  }
});

test("recorded Scion consumer identity retains its brand and source keyword", async () => {
  const { default: recordings } =
    await import("./vpic-test-fixtures/review-identities.json");
  const { VinDecode } = await import("./vin-decode");
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
    const database = drizzle(client);
    const source = {
      ...makeVehicle("JTKDE167180245861"),
      year: 2008,
      make: "Scion",
      model: "TC",
    };
    await warmVinDecodeCache(database, [source], {
      decode: async (requests) => ({
        status: "complete",
        decodes: VinDecode.parseResponse(
          { Results: recordings.map((row) => row.response) },
          requests,
        ),
      }),
    });
    const [canonical] = await canonicalizeVinVehicles(database, [source]);
    if (!canonical) throw new Error("Missing Scion identity");
    expect(canonical).toMatchObject({
      make: "Scion",
      model: "tC",
      sourceMake: "Scion",
      sourceModel: "TC",
    });
    expect(
      toAlgoliaRecord(canonical, new Date(), null, 0, null).makeAliases,
    ).toEqual(["Scion"]);
  } finally {
    client.close();
  }
});

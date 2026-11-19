import { expect, test } from "bun:test";
import type {
  LegacySearchMethodProps,
  SearchMethodParams,
  SearchResponses,
} from "algoliasearch/lite";
import {
  fullServiceCountParams,
  readFullServiceCount,
  withFullServiceCount,
} from "./full-service-search";

const params = {
  query: "Volvo 740",
  facetFilters: [
    ["yardTypes:self_service"],
    ["state:California", "state:Oregon"],
    "make:Volvo",
  ],
  filters: 'vinPatternTokens:"test"',
  numericFilters: ["year>=1987", "year<=1987"],
  aroundLatLng: "30, -97",
  page: 2,
};

test("extra count preserves query, other filters and geo, excludes already included both yards", () => {
  const extra = fullServiceCountParams(params);
  expect(extra).toMatchObject({
    ...params,
    filters:
      'vinPatternTokens:"test" AND yardTypes:full_service AND NOT yardTypes:self_service',
    page: 0,
    hitsPerPage: 0,
    facets: ["yardTypes"],
    analytics: false,
    facetFilters: [["state:California", "state:Oregon"], "make:Volvo"],
  });
  expect(extra?.filters).toContain(params.filters);
  expect(extra?.filters).toContain(
    "yardTypes:full_service AND NOT yardTypes:self_service",
  );
  expect(params.facetFilters[0]).toEqual(["yardTypes:self_service"]);
});

test("explicit full-service, both and all do not request extra counts", () => {
  for (const facetFilters of [
    undefined,
    [],
    [["yardTypes:full_service"]],
    [["yardTypes:self_service", "yardTypes:full_service"]],
  ]) {
    expect(fullServiceCountParams({ query: "Volvo", facetFilters })).toBeNull();
  }
});

for (const modern of [false, true]) {
  test(`count shares one multi-query call and hides its response, modern=${modern}`, async () => {
    const calls: Array<SearchMethodParams | LegacySearchMethodProps> = [];
    const client = withFullServiceCount({
      async search<T>(
        input: SearchMethodParams | LegacySearchMethodProps,
      ): Promise<SearchResponses<T>> {
        calls.push(input);
        const requests = Array.isArray(input) ? input : input.requests;
        return {
          results: requests.map((request, index) => ({
            hits: [],
            index: request.indexName,
            nbHits: 10,
            userData: [{ preserved: true }],
            facets: { yardTypes: { full_service: index === 2 ? 38 : 900 } },
          })),
        };
      },
    });
    const input = modern
      ? {
          requests: [
            { indexName: "vehicles_newest", ...params },
            { indexName: "vehicles_newest", query: "Volvo", facets: ["state"] },
          ],
        }
      : [
          { indexName: "vehicles_newest", params },
          {
            indexName: "vehicles_newest",
            params: { query: "Volvo", facets: ["state"] },
          },
        ];
    const response = await client.search(input);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call && (Array.isArray(call) ? call : call.requests)).toHaveLength(
      3,
    );
    expect(response.results).toHaveLength(2);
    const main = response.results[0];
    expect(main && "userData" in main && main.userData).toEqual([
      { preserved: true },
      { fullServiceExtraMatches: 38 },
    ]);
    expect(
      main && "userData" in main && readFullServiceCount(main.userData),
    ).toBe(38);
    expect(response.results[1]).toMatchObject({
      userData: [{ preserved: true }],
    });
  });
}

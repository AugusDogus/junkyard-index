import { expect, test } from "bun:test";
import type {
  LegacySearchMethodProps,
  SearchMethodParams,
  SearchResponses,
} from "algoliasearch/lite";
import { withSearchCountsCache } from "./search-counts-cache";
import {
  withFullServiceCount,
  readFullServiceCount,
} from "./full-service-search";

function fixture() {
  const calls: Array<SearchMethodParams | LegacySearchMethodProps> = [];
  const client = withSearchCountsCache({
    async search<T>(
      input: SearchMethodParams | LegacySearchMethodProps,
    ): Promise<SearchResponses<T>> {
      calls.push(input);
      const requests = Array.isArray(input) ? input : input.requests;
      return {
        results: requests.map((request) => ({
          hits: [],
          nbHits: 96,
          index: request.indexName,
          facets: { yardTypes: { self_service: 96, full_service: 8 } },
        })),
      };
    },
  });
  return { client, calls };
}
const params = {
  query: "civic",
  facetFilters: [["yardTypes:self_service"]],
  hitsPerPage: 24,
};
const count = {
  query: "civic",
  facets: ["yardTypes"],
  page: 0,
  hitsPerPage: 0,
};

for (const modern of [false, true]) {
  test(`SSR seeds disjunctive and full-service counts so each scroll sends one query, modern=${modern}`, async () => {
    const input = (page: number) =>
      modern
        ? {
            requests: [
              { indexName: "vehicles", ...params, page },
              { indexName: "vehicles", ...count },
            ],
          }
        : [
            { indexName: "vehicles", params: { ...params, page } },
            { indexName: "vehicles", params: count },
          ];
    const server = fixture();
    const initial = await withFullServiceCount(server.client).search(input(0));
    const browser = fixture();
    const main = initial.results[0];
    browser.client.primeCounts(
      main && "userData" in main ? main.userData : undefined,
    );
    for (const page of [1, 2]) {
      const response = await withFullServiceCount(browser.client).search(
        input(page),
      );
      const sent = browser.calls[page - 1];
      expect(sent && (Array.isArray(sent) ? sent : sent.requests)).toHaveLength(
        1,
      );
      expect(response.results).toHaveLength(2);
      const main = response.results[0];
      expect(
        readFullServiceCount(
          main && "userData" in main ? main.userData : undefined,
        ),
      ).toBe(8);
    }
  });
}

test("query, filter and geo changes invalidate counts; hits and facet-value searches are never cached", async () => {
  const { client, calls } = fixture();
  for (const extra of [
    {},
    { query: "camry" },
    { filters: "year:2010" },
    { aroundLatLng: "30,-97" },
  ]) {
    await client.search([
      { indexName: "vehicles", params: { ...count, ...extra } },
    ]);
  }
  expect(calls).toHaveLength(4);
  await client.search([{ indexName: "vehicles", params: count }]);
  expect(calls).toHaveLength(4);
  for (let i = 0; i < 2; i++) {
    await client.search([{ indexName: "vehicles", params }]);
    await client.search({
      requests: [
        {
          indexName: "vehicles",
          type: "facet",
          facet: "make",
          facetQuery: "hon",
        },
      ],
    });
  }
  expect(calls).toHaveLength(8);
});

test("corrupt and expired SSR count metadata cannot seed the cache", async () => {
  const server = fixture();
  const initial = await server.client.search([
    { indexName: "vehicles", params },
    { indexName: "vehicles", params: count },
  ]);
  const first = initial.results[0];
  const data: unknown =
    first && "userData" in first ? first.userData : undefined;
  const browser = fixture();
  browser.client.primeCounts([{ searchCounts: "invalid" }]);
  browser.client.primeCounts(
    JSON.parse(JSON.stringify(data).replace(/"savedAt":\d+/g, '"savedAt":0')),
  );
  await browser.client.search([{ indexName: "vehicles", params: count }]);
  expect(browser.calls).toHaveLength(1);
});

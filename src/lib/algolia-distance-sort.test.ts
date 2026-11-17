import { expect, test } from "bun:test";
import type {
  LegacySearchMethodProps,
  SearchMethodParams,
  SearchResponses,
} from "algoliasearch/lite";
import { withDistanceSort } from "./algolia-distance-sort";

function searchFixture() {
  const calls: Array<SearchMethodParams | LegacySearchMethodProps> = [];
  const client = withDistanceSort({
    async search<T>(
      input: SearchMethodParams | LegacySearchMethodProps,
    ): Promise<SearchResponses<T>> {
      calls.push(input);
      const requests = Array.isArray(input) ? input : input.requests;
      return {
        results: requests.map((request) =>
          request.type === "facet"
            ? {
                facetHits: [],
                exhaustiveFacetsCount: true,
                processingTimeMS: 0,
              }
            : { hits: [], index: request.indexName, page: 0, nbHits: 0 },
        ),
      };
    },
  });
  return { calls, client };
}

test("distance searches use the primary with 10-meter buckets and preserve UI identity", async () => {
  const { calls, client } = searchFixture();
  const request = {
    indexName: "vehicles_distance",
    params: {
      query: "civic",
      aroundLatLng: "30, -97",
      filters: 'make:"Honda"',
      page: 2,
    },
  };
  const result = await client.search([request]);
  expect(calls).toEqual([
    [
      {
        ...request,
        indexName: "vehicles",
        params: { ...request.params, aroundPrecision: 10, aroundRadius: "all" },
      },
    ],
  ]);
  expect(result.results[0]).toMatchObject({ index: "vehicles_distance" });
  expect(request.indexName).toBe("vehicles_distance");
});

test("modern hit and facet searches share the alias without changing other sorts", async () => {
  const { calls, client } = searchFixture();
  const input = {
    strategy: "none",
    requests: [
      {
        indexName: "vehicles_distance",
        query: "ford",
        aroundLatLngViaIP: true,
      },
      {
        indexName: "vehicles_distance",
        type: "facet",
        facet: "make",
        facetQuery: "fo",
      },
      { indexName: "vehicles", query: "ford" },
      { indexName: "vehicles_oldest", query: "ford" },
    ],
  } satisfies SearchMethodParams;
  const result = await client.search(input);
  expect(calls[0]).toEqual({
    ...input,
    requests: input.requests.map((request) =>
      request.indexName === "vehicles_distance"
        ? {
            ...request,
            indexName: "vehicles",
            aroundPrecision: 10,
            aroundRadius: "all",
          }
        : request,
    ),
  });
  expect(result.results).toEqual([
    { hits: [], index: "vehicles_distance", page: 0, nbHits: 0 },
    { facetHits: [], exhaustiveFacetsCount: true, processingTimeMS: 0 },
    { hits: [], index: "vehicles", page: 0, nbHits: 0 },
    { hits: [], index: "vehicles_oldest", page: 0, nbHits: 0 },
  ]);
});

test("legacy facet requests also use the primary", async () => {
  const { calls, client } = searchFixture();
  // InstantSearch's legacy facet request nests facetQuery in params.
  const params = { query: "", facetQuery: "hon" };
  await client.search([
    { indexName: "vehicles_distance", type: "facet", facet: "make", params },
  ]);
  expect(calls[0]).toEqual([
    {
      indexName: "vehicles",
      type: "facet",
      facet: "make",
      params: { ...params, aroundPrecision: 10, aroundRadius: "all" },
    },
  ]);
});

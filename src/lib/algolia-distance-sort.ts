import type {
  LegacySearchMethodProps,
  LiteClient,
  SearchMethodParams,
} from "algoliasearch/lite";
import { ALGOLIA_DISTANCE_SORT_ALIAS, ALGOLIA_INDEX_NAME } from "./constants";

// Match the old replica's default precision. Newest only breaks ties after
// geo and all text relevance criteria, including vehicles at the same yard.
const DISTANCE_SEARCH_PARAMS = {
  aroundPrecision: 10,
  aroundRadius: "all",
} as const;

/** Keep distance distinct from newest in InstantSearch while sharing records. */
export function withDistanceSort<Client extends Pick<LiteClient, "search">>(
  client: Client,
) {
  return {
    ...client,
    async search<T>(
      input: SearchMethodParams | LegacySearchMethodProps,
      requestOptions?: Parameters<LiteClient["search"]>[1],
    ) {
      const requests = Array.isArray(input) ? input : input.requests;
      const routed = Array.isArray(input)
        ? input.map((request) =>
            request.indexName === ALGOLIA_DISTANCE_SORT_ALIAS
              ? {
                  ...request,
                  indexName: ALGOLIA_INDEX_NAME,
                  params: {
                    ...DISTANCE_SEARCH_PARAMS,
                    ...request.params,
                    aroundPrecision: 10,
                  },
                }
              : request,
          )
        : {
            ...input,
            requests: input.requests.map((request) =>
              request.indexName === ALGOLIA_DISTANCE_SORT_ALIAS
                ? {
                    ...DISTANCE_SEARCH_PARAMS,
                    ...request,
                    indexName: ALGOLIA_INDEX_NAME,
                    aroundPrecision: 10,
                  }
                : request,
            ),
          };
      const response = await client.search<T>(routed, requestOptions);
      return {
        ...response,
        results: response.results.map((result, index) =>
          requests[index]?.indexName === ALGOLIA_DISTANCE_SORT_ALIAS &&
          "hits" in result
            ? { ...result, index: ALGOLIA_DISTANCE_SORT_ALIAS }
            : result,
        ),
      };
    },
  };
}

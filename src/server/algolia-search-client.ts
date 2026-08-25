import "server-only";

import { algoliasearch } from "algoliasearch";
import { env } from "~/env";

export const algoliaSearchClient = algoliasearch(
  env.NEXT_PUBLIC_ALGOLIA_APP_ID,
  env.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY,
);

import "server-only";
import { algoliasearch } from "algoliasearch";
import { env } from "~/env";

export const ALGOLIA_INDEX_NAME = "vehicles";

export const algoliaClient = algoliasearch(
  env.NEXT_PUBLIC_ALGOLIA_APP_ID,
  env.ALGOLIA_WRITE_API_KEY,
);

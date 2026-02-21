import { liteClient as algoliasearch } from "algoliasearch/lite";

export const ALGOLIA_INDEX_NAME = "vehicles";

export const searchClient = algoliasearch(
  process.env.NEXT_PUBLIC_ALGOLIA_APP_ID!,
  process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_KEY!,
);

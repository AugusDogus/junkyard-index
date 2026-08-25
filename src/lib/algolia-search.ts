import { liteClient as algoliasearch } from "algoliasearch/lite";
import { env } from "~/env";
export { ALGOLIA_INDEX_NAME } from "~/lib/constants";

// Deliberate latency tradeoff: searches go directly from the browser to
// Algolia instead of through our server. This public key must remain restricted
// to search-only operations on the public vehicle index. It is not a secret and
// must never be replaced here with an admin or write-capable key.
export const searchClient = algoliasearch(
  env.NEXT_PUBLIC_ALGOLIA_APP_ID,
  env.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY,
);

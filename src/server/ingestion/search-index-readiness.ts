import "server-only";
import { unstable_cache } from "next/cache";
import { algoliaAdminClient, ALGOLIA_INDEX_NAME } from "~/lib/algolia";
import {
  isAdvancedSearchReady,
  isVinPatternSearchReady,
} from "~/lib/search-index-schema";

export interface SearchIndexCapabilities {
  vinPatternSearchReady: boolean;
  booleanOrSearchReady: boolean;
}

async function readSearchIndexCapabilities(): Promise<SearchIndexCapabilities> {
  try {
    const settings = await algoliaAdminClient.getSettings({
      indexName: ALGOLIA_INDEX_NAME,
    });
    return {
      vinPatternSearchReady: isVinPatternSearchReady(settings.userData),
      booleanOrSearchReady: isAdvancedSearchReady(settings.userData),
    };
  } catch (error) {
    console.error(
      "Could not read the Algolia search schema version. VIN patterns and Boolean OR search remain disabled until readiness can be confirmed.",
      error,
    );
    return {
      vinPatternSearchReady: false,
      booleanOrSearchReady: false,
    };
  }
}

export const getSearchIndexCapabilities = unstable_cache(
  readSearchIndexCapabilities,
  ["search-index-capabilities"],
  { revalidate: 30 },
);

import "server-only";
import { unstable_cache } from "next/cache";
import { ALGOLIA_INDEX_NAME, getAlgoliaAdminClient } from "~/lib/algolia";
import {
  CHRONOLOGICAL_SEARCH_SCHEMA_VERSION,
  VIN_CANONICAL_SEARCH_SCHEMA_VERSION,
  getSearchSchemaVersion,
  isAdvancedSearchReady,
  isVinPatternSearchReady,
} from "~/lib/search-index-schema";

export interface SearchIndexCapabilities {
  vinPatternSearchReady: boolean;
  booleanOrSearchReady: boolean;
  newestSortReady: boolean;
  makeAliasesReady: boolean;
}

async function readSearchIndexCapabilities(): Promise<SearchIndexCapabilities> {
  try {
    const settings = await getAlgoliaAdminClient().getSettings({
      indexName: ALGOLIA_INDEX_NAME,
    });
    return {
      makeAliasesReady:
        getSearchSchemaVersion(settings.userData) >=
        VIN_CANONICAL_SEARCH_SCHEMA_VERSION,
      vinPatternSearchReady: isVinPatternSearchReady(settings.userData),
      booleanOrSearchReady: isAdvancedSearchReady(settings.userData),
      newestSortReady:
        getSearchSchemaVersion(settings.userData) >=
        CHRONOLOGICAL_SEARCH_SCHEMA_VERSION,
    };
  } catch (error) {
    console.error(
      "Could not read the Algolia search schema version. VIN patterns, Boolean OR search, and newest sorting remain disabled until readiness can be confirmed.",
      error,
    );
    return {
      makeAliasesReady: false,
      vinPatternSearchReady: false,
      booleanOrSearchReady: false,
      newestSortReady: false,
    };
  }
}

export const getSearchIndexCapabilities = unstable_cache(
  readSearchIndexCapabilities,
  ["search-index-capabilities:v12"],
  { revalidate: 30 },
);

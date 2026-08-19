import "server-only";
import { unstable_cache } from "next/cache";
import { algoliaClient, ALGOLIA_INDEX_NAME } from "~/lib/algolia";
import { isVinPatternSearchReady } from "~/lib/search-index-schema";

async function readVinPatternSearchReadiness(): Promise<boolean> {
  try {
    const settings = await algoliaClient.getSettings({
      indexName: ALGOLIA_INDEX_NAME,
    });
    return isVinPatternSearchReady(settings.userData);
  } catch (error) {
    console.error(
      "Could not read the Algolia search schema version. VIN search remains disabled until readiness can be confirmed.",
      error,
    );
    return false;
  }
}

export const getVinPatternSearchReadiness = unstable_cache(
  readVinPatternSearchReadiness,
  ["vin-pattern-search-readiness"],
  { revalidate: 30 },
);

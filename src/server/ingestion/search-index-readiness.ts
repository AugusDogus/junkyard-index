import { algoliaClient, ALGOLIA_INDEX_NAME } from "~/lib/algolia";
import { isVinPatternSearchReady } from "~/lib/search-index-schema";

export async function getVinPatternSearchReadiness(): Promise<boolean> {
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

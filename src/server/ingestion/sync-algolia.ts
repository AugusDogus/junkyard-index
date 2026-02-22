import { algoliaClient, ALGOLIA_INDEX_NAME } from "~/lib/algolia";
import type { AlgoliaVehicleRecord } from "./types";

const BATCH_SIZE = 1000;

/**
 * Configure Algolia index settings. Idempotent — safe to call on every run.
 */
export async function configureAlgoliaIndex(): Promise<void> {
  console.log("[Algolia] Configuring index settings...");
  await algoliaClient.setSettings({
    indexName: ALGOLIA_INDEX_NAME,
    indexSettings: {
      searchableAttributes: [
        "make",
        "model",
        "year",
        "unordered(color)",
        "unordered(vin)",
      ],
      attributesForFaceting: [
        "source",
        "searchable(make)",
        "searchable(model)",
        "searchable(color)",
        "searchable(state)",
        "filterOnly(stateAbbr)",
        "searchable(locationName)",
        "year",
      ],
      numericAttributesForFiltering: ["year", "availableDateTs", "firstSeenAt"],
      customRanking: ["desc(availableDateTs)"],
      // Virtual replicas for sort options
      replicas: [
        "virtual(vehicles_oldest)",
        "virtual(vehicles_year_desc)",
        "virtual(vehicles_year_asc)",
        "virtual(vehicles_distance)",
      ],
      // Typo tolerance settings
      typoTolerance: true,
      minWordSizefor1Typo: 3,
      minWordSizefor2Typos: 7,
      // Pagination — large page size so most queries load in 1-2 pages
      hitsPerPage: 1000,
      paginationLimitedTo: 10000,
      // Unretrievable attributes (keep admin key out of search results)
      unretrievableAttributes: ["firstSeenAt"],
    },
  });
  // Configure virtual replica sort orders.
  // relevancyStrictness: 0 disables Algolia's "Relevant Sort" which otherwise
  // limits results to only those it considers "relevantly sorted" (nbSortedHits).
  // Without this, sort replicas return only a handful of results.
  const replicaDefaults = { hitsPerPage: 1000, relevancyStrictness: 0 };
  await algoliaClient.setSettings({
    indexName: "vehicles_oldest",
    indexSettings: {
      ...replicaDefaults,
      customRanking: ["asc(availableDateTs)"],
    },
  });
  await algoliaClient.setSettings({
    indexName: "vehicles_year_desc",
    indexSettings: { ...replicaDefaults, customRanking: ["desc(year)"] },
  });
  await algoliaClient.setSettings({
    indexName: "vehicles_year_asc",
    indexSettings: { ...replicaDefaults, customRanking: ["asc(year)"] },
  });
  await algoliaClient.setSettings({
    indexName: "vehicles_distance",
    indexSettings: { ...replicaDefaults, customRanking: [] },
  });
  console.log("[Algolia] Index settings configured");
}

/**
 * Batch save objects to Algolia.
 */
export async function saveAlgoliaObjects(
  records: AlgoliaVehicleRecord[],
): Promise<void> {
  if (records.length === 0) return;

  console.log(
    `[Algolia] Saving ${records.length} objects in batches of ${BATCH_SIZE}...`,
  );

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    await algoliaClient.saveObjects({
      indexName: ALGOLIA_INDEX_NAME,
      objects: batch as unknown as Record<string, unknown>[],
    });
    console.log(
      `[Algolia] Saved batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(records.length / BATCH_SIZE)}`,
    );
  }
}

/**
 * Batch delete objects from Algolia by objectID (VIN).
 */
export async function deleteAlgoliaObjects(vins: string[]): Promise<void> {
  if (vins.length === 0) return;

  console.log(`[Algolia] Deleting ${vins.length} objects...`);

  for (let i = 0; i < vins.length; i += BATCH_SIZE) {
    const batch = vins.slice(i, i + BATCH_SIZE);
    await algoliaClient.deleteObjects({
      indexName: ALGOLIA_INDEX_NAME,
      objectIDs: batch,
    });
  }
}

/**
 * Full sync: save upserted records and delete stale ones.
 */
export async function syncToAlgolia(
  upserted: AlgoliaVehicleRecord[],
  deletedVins: string[],
): Promise<void> {
  // Configure index settings (idempotent)
  await configureAlgoliaIndex();

  // Save new/updated records
  await saveAlgoliaObjects(upserted);

  // Delete stale records
  await deleteAlgoliaObjects(deletedVins);

  console.log(
    `[Algolia] Sync complete: ${upserted.length} saved, ${deletedVins.length} deleted`,
  );
}

import type { IndexSettings, SearchClient } from "algoliasearch";
import {
  ALGOLIA_DISTANCE_SORT_ALIAS,
  ALGOLIA_INDEX_NAME,
  ALGOLIA_PAGINATION_LIMIT,
  ALGOLIA_REPLICA_INDEX_NAMES,
  type AlgoliaSearchIndexName,
} from "~/lib/constants";

export type AlgoliaSettingsOperation =
  | {
      kind: "settings";
      indexName: AlgoliaSearchIndexName;
      indexSettings: IndexSettings;
      forwardToReplicas: boolean;
    }
  | { kind: "delete"; indexName: typeof ALGOLIA_DISTANCE_SORT_ALIAS };

export const COMMON_ALGOLIA_INDEX_SETTINGS = {
  searchableAttributes: [
    "make",
    "model",
    "year",
    "unordered(color)",
    "unordered(vin)",
  ],
  attributesForFaceting: [
    "source",
    "yardTypes",
    "searchable(make)",
    "searchable(model)",
    "searchable(color)",
    "searchable(state)",
    "filterOnly(stateAbbr)",
    "searchable(locationName)",
    "filterOnly(vinPositionTokens)",
    "filterOnly(searchTokens)",
    "year",
  ],
  numericAttributesForFiltering: ["year", "availableDateTs", "firstSeenAt"],
  typoTolerance: true,
  // Years and model numbers must not match neighboring numeric values.
  allowTyposOnNumericTokens: false,
  minWordSizefor1Typo: 3,
  minWordSizefor2Typos: 7,
  advancedSyntax: true,
  advancedSyntaxFeatures: ["exactPhrase", "excludeWords"],
  hitsPerPage: 1000,
  paginationLimitedTo: ALGOLIA_PAGINATION_LIMIT,
  unretrievableAttributes: ["firstSeenAt", "vinPositionTokens", "searchTokens"],
} satisfies IndexSettings;

export function buildAlgoliaSettingsPlan(): readonly AlgoliaSettingsOperation[] {
  const [oldestIndex, yearDescIndex, yearAscIndex, newestIndex] =
    ALGOLIA_REPLICA_INDEX_NAMES;
  const virtualReplicaDefaults = {
    hitsPerPage: 1000,
    relevancyStrictness: 0,
  } satisfies IndexSettings;

  return [
    {
      kind: "settings",
      indexName: ALGOLIA_INDEX_NAME,
      indexSettings: {
        replicas: [
          `virtual(${oldestIndex})`,
          `virtual(${yearDescIndex})`,
          `virtual(${yearAscIndex})`,
          `virtual(${newestIndex})`,
        ],
      },
      forwardToReplicas: false,
    },
    {
      kind: "settings",
      indexName: ALGOLIA_INDEX_NAME,
      indexSettings: COMMON_ALGOLIA_INDEX_SETTINGS,
      forwardToReplicas: true,
    },
    {
      kind: "settings",
      indexName: ALGOLIA_INDEX_NAME,
      indexSettings: {
        // Pin the default explicitly so geo sorting doesn't depend on dashboard drift.
        ranking: [
          "typo",
          "geo",
          "words",
          "filters",
          "proximity",
          "attribute",
          "exact",
          "custom",
        ],
        customRanking: ["desc(arrivalDateKnown)", "desc(availableDateTs)"],
      },
      forwardToReplicas: false,
    },
    {
      kind: "settings",
      indexName: oldestIndex,
      indexSettings: {
        ...virtualReplicaDefaults,
        customRanking: ["desc(arrivalDateKnown)", "asc(availableDateTs)"],
      },
      forwardToReplicas: false,
    },
    {
      kind: "settings",
      indexName: yearDescIndex,
      indexSettings: {
        ...virtualReplicaDefaults,
        customRanking: ["desc(year)"],
      },
      forwardToReplicas: false,
    },
    {
      kind: "settings",
      indexName: yearAscIndex,
      indexSettings: {
        ...virtualReplicaDefaults,
        customRanking: ["asc(year)"],
      },
      forwardToReplicas: false,
    },
    {
      kind: "settings",
      indexName: newestIndex,
      indexSettings: {
        ...virtualReplicaDefaults,
        customRanking: ["desc(arrivalDateKnown)", "desc(availableDateTs)"],
      },
      forwardToReplicas: false,
    },
    // Removing a replica only detaches it. Delete the now-independent copy
    // after every settings task completes so it stops counting toward billing.
    { kind: "delete", indexName: ALGOLIA_DISTANCE_SORT_ALIAS },
  ];
}

export async function applyAlgoliaSettingsPlan(
  client: Pick<SearchClient, "setSettings" | "deleteIndex" | "waitForTask">,
): Promise<void> {
  for (const operation of buildAlgoliaSettingsPlan()) {
    const response =
      operation.kind === "settings"
        ? await client.setSettings({
            indexName: operation.indexName,
            indexSettings: operation.indexSettings,
            forwardToReplicas: operation.forwardToReplicas,
          })
        : await client.deleteIndex({ indexName: operation.indexName });
    await client.waitForTask({
      indexName: operation.indexName,
      taskID: response.taskID,
    });
  }
}

import type { IndexSettings } from "algoliasearch";
import {
  ALGOLIA_INDEX_NAME,
  ALGOLIA_PAGINATION_LIMIT,
  ALGOLIA_REPLICA_INDEX_NAMES,
  type AlgoliaSearchIndexName,
} from "~/lib/constants";

export interface AlgoliaSettingsOperation {
  indexName: AlgoliaSearchIndexName;
  indexSettings: IndexSettings;
  forwardToReplicas: boolean;
}

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
  minWordSizefor1Typo: 3,
  minWordSizefor2Typos: 7,
  advancedSyntax: true,
  advancedSyntaxFeatures: ["exactPhrase", "excludeWords"],
  hitsPerPage: 1000,
  paginationLimitedTo: ALGOLIA_PAGINATION_LIMIT,
  unretrievableAttributes: ["firstSeenAt", "vinPositionTokens", "searchTokens"],
} satisfies IndexSettings;

export function buildAlgoliaSettingsPlan(): readonly AlgoliaSettingsOperation[] {
  const [oldestIndex, yearDescIndex, yearAscIndex, distanceIndex] =
    ALGOLIA_REPLICA_INDEX_NAMES;
  const virtualReplicaDefaults = {
    hitsPerPage: 1000,
    relevancyStrictness: 0,
  } satisfies IndexSettings;

  return [
    {
      indexName: ALGOLIA_INDEX_NAME,
      indexSettings: {
        replicas: [
          `virtual(${oldestIndex})`,
          `virtual(${yearDescIndex})`,
          `virtual(${yearAscIndex})`,
          distanceIndex,
        ],
      },
      forwardToReplicas: false,
    },
    {
      indexName: ALGOLIA_INDEX_NAME,
      indexSettings: COMMON_ALGOLIA_INDEX_SETTINGS,
      forwardToReplicas: true,
    },
    {
      indexName: ALGOLIA_INDEX_NAME,
      indexSettings: { customRanking: ["desc(availableDateTs)"] },
      forwardToReplicas: false,
    },
    {
      indexName: oldestIndex,
      indexSettings: {
        ...virtualReplicaDefaults,
        customRanking: ["asc(availableDateTs)"],
      },
      forwardToReplicas: false,
    },
    {
      indexName: yearDescIndex,
      indexSettings: {
        ...virtualReplicaDefaults,
        customRanking: ["desc(year)"],
      },
      forwardToReplicas: false,
    },
    {
      indexName: yearAscIndex,
      indexSettings: {
        ...virtualReplicaDefaults,
        customRanking: ["asc(year)"],
      },
      forwardToReplicas: false,
    },
    {
      indexName: distanceIndex,
      indexSettings: {
        ...COMMON_ALGOLIA_INDEX_SETTINGS,
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
        customRanking: [],
      },
      forwardToReplicas: false,
    },
  ];
}

import { describe, expect, test } from "bun:test";
import {
  ALGOLIA_INDEX_NAME,
  ALGOLIA_REPLICA_INDEX_NAMES,
} from "~/lib/constants";
import {
  buildAlgoliaSettingsPlan,
  COMMON_ALGOLIA_INDEX_SETTINGS,
} from "./algolia-settings-plan";

describe("Algolia settings plan", () => {
  test("creates replicas before forwarding the VIN filtering settings", () => {
    const plan = buildAlgoliaSettingsPlan();
    const [oldestIndex, yearDescIndex, yearAscIndex, distanceIndex] =
      ALGOLIA_REPLICA_INDEX_NAMES;

    expect(plan[0]).toEqual({
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
    });
    expect(plan[1]).toEqual({
      indexName: ALGOLIA_INDEX_NAME,
      indexSettings: COMMON_ALGOLIA_INDEX_SETTINGS,
      forwardToReplicas: true,
    });
    expect(COMMON_ALGOLIA_INDEX_SETTINGS.attributesForFaceting).toContain(
      "filterOnly(vinPositionTokens)",
    );
    expect(COMMON_ALGOLIA_INDEX_SETTINGS.attributesForFaceting).toContain(
      "filterOnly(searchTokens)",
    );
    expect(COMMON_ALGOLIA_INDEX_SETTINGS.unretrievableAttributes).toContain(
      "vinPositionTokens",
    );
    expect(COMMON_ALGOLIA_INDEX_SETTINGS.unretrievableAttributes).toContain(
      "searchTokens",
    );
    expect(COMMON_ALGOLIA_INDEX_SETTINGS).toMatchObject({
      advancedSyntax: true,
      advancedSyntaxFeatures: ["exactPhrase", "excludeWords"],
    });
  });

  test("restores each replica's intended ordering after forwarding settings", () => {
    const plan = buildAlgoliaSettingsPlan();
    const replicaOperations = plan.slice(3);

    expect(replicaOperations.map((operation) => operation.indexName)).toEqual([
      ...ALGOLIA_REPLICA_INDEX_NAMES,
    ]);
    expect(replicaOperations[0]?.indexSettings.customRanking).toEqual([
      "asc(availableDateTs)",
    ]);
    expect(replicaOperations[1]?.indexSettings.customRanking).toEqual([
      "desc(year)",
    ]);
    expect(replicaOperations[2]?.indexSettings.customRanking).toEqual([
      "asc(year)",
    ]);
    expect(replicaOperations[3]?.indexSettings).toMatchObject({
      attributesForFaceting:
        COMMON_ALGOLIA_INDEX_SETTINGS.attributesForFaceting,
      unretrievableAttributes:
        COMMON_ALGOLIA_INDEX_SETTINGS.unretrievableAttributes,
      customRanking: [],
    });
    expect(replicaOperations[3]?.indexSettings.ranking?.[1]).toBe("geo");
  });
});

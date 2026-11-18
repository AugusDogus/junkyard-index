import { describe, expect, test } from "bun:test";
import type { SearchClient } from "algoliasearch";
import {
  ALGOLIA_INDEX_NAME,
  ALGOLIA_REPLICA_INDEX_NAMES,
} from "~/lib/constants";
import {
  buildAlgoliaSettingsPlan,
  applyAlgoliaSettingsPlan,
  COMMON_ALGOLIA_INDEX_SETTINGS,
} from "./algolia-settings-plan";

describe("Algolia settings plan", () => {
  test("creates replicas before forwarding the VIN filtering settings", () => {
    const plan = buildAlgoliaSettingsPlan();
    const [oldestIndex, yearDescIndex, yearAscIndex] =
      ALGOLIA_REPLICA_INDEX_NAMES;

    expect(plan[0]).toEqual({
      kind: "settings",
      indexName: ALGOLIA_INDEX_NAME,
      indexSettings: {
        replicas: [
          `virtual(${oldestIndex})`,
          `virtual(${yearDescIndex})`,
          `virtual(${yearAscIndex})`,
        ],
      },
      forwardToReplicas: false,
    });
    expect(plan[1]).toEqual({
      kind: "settings",
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
    const replicaOperations = plan
      .slice(3)
      .filter((operation) => operation.kind === "settings");

    expect(replicaOperations.map((operation) => operation.indexName)).toEqual([
      ...ALGOLIA_REPLICA_INDEX_NAMES,
    ]);
    expect(replicaOperations[0]?.indexSettings.customRanking).toEqual([
      "desc(arrivalDateKnown)",
      "asc(availableDateTs)",
    ]);
    expect(replicaOperations[1]?.indexSettings.customRanking).toEqual([
      "desc(year)",
    ]);
    expect(replicaOperations[2]?.indexSettings.customRanking).toEqual([
      "asc(year)",
    ]);
    expect(plan[2]).toMatchObject({
      kind: "settings",
      indexName: ALGOLIA_INDEX_NAME,
      indexSettings: {
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
    });
    expect(plan.at(-1)).toEqual({
      kind: "delete",
      indexName: "vehicles_distance",
    });
    expect(
      plan
        .filter((operation) => operation.kind === "settings")
        .map((operation) => operation.indexName),
    ).toEqual([
      "vehicles",
      "vehicles",
      "vehicles",
      "vehicles_oldest",
      "vehicles_year_desc",
      "vehicles_year_asc",
    ]);
  });
});

function settingsFixture(failWait = false) {
  const calls: string[] = [];
  let taskID = 0;
  const client = {
    async setSettings({ indexName }) {
      calls.push(`settings:${indexName}`);
      return { taskID: ++taskID, updatedAt: "2026-11-17T00:00:00Z" };
    },
    async deleteIndex({ indexName }) {
      calls.push(`delete:${indexName}`);
      return { taskID: ++taskID, deletedAt: "2026-11-17T00:00:00Z" };
    },
    async waitForTask({ indexName, taskID }) {
      calls.push(`wait:${indexName}:${taskID}`);
      if (failWait) throw new Error("settings task failed");
      return { status: "published" as const };
    },
  } satisfies Pick<SearchClient, "setSettings" | "deleteIndex" | "waitForTask">;
  return { calls, client };
}

test("settings apply waits for detachment and configuration before deleting the old copy", async () => {
  const { client, calls } = settingsFixture();
  await applyAlgoliaSettingsPlan(client);
  expect(calls).toEqual([
    "settings:vehicles",
    "wait:vehicles:1",
    "settings:vehicles",
    "wait:vehicles:2",
    "settings:vehicles",
    "wait:vehicles:3",
    "settings:vehicles_oldest",
    "wait:vehicles_oldest:4",
    "settings:vehicles_year_desc",
    "wait:vehicles_year_desc:5",
    "settings:vehicles_year_asc",
    "wait:vehicles_year_asc:6",
    "delete:vehicles_distance",
    "wait:vehicles_distance:7",
  ]);
});

test("failed settings tasks stop apply before deletion", async () => {
  const { client, calls } = settingsFixture(true);
  await expect(applyAlgoliaSettingsPlan(client)).rejects.toThrow(
    "settings task failed",
  );
  expect(calls).toEqual(["settings:vehicles", "wait:vehicles:1"]);
});

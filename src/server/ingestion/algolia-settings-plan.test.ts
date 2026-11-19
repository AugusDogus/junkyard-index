import { describe, expect, test } from "bun:test";
import type { IndexSettings, SearchClient } from "algoliasearch";
import {
  ALGOLIA_INDEX_NAME,
  ALGOLIA_REPLICA_INDEX_NAMES,
  ALGOLIA_SEARCH_INDEX_NAMES,
} from "~/lib/constants";
import {
  buildAlgoliaSettingsPlan,
  applyAlgoliaSettingsPlan,
  COMMON_ALGOLIA_INDEX_SETTINGS,
} from "./algolia-settings-plan";

describe("Algolia settings plan", () => {
  test("preserves numeric precision and exact VIN matching on every index after all overrides", () => {
    const settings = new Map<string, IndexSettings>(
      ALGOLIA_SEARCH_INDEX_NAMES.map((indexName) => [
        indexName,
        { allowTyposOnNumericTokens: true },
      ]),
    );
    for (const operation of buildAlgoliaSettingsPlan()) {
      if (operation.kind !== "settings") continue;
      const targets = operation.forwardToReplicas
        ? ALGOLIA_SEARCH_INDEX_NAMES
        : [operation.indexName];
      for (const indexName of targets) {
        settings.set(indexName, {
          ...settings.get(indexName),
          ...operation.indexSettings,
        });
      }
    }

    for (const indexName of ALGOLIA_SEARCH_INDEX_NAMES) {
      expect(settings.get(indexName)).toMatchObject({
        allowTyposOnNumericTokens: false,
        typoTolerance: true,
        minWordSizefor1Typo: 3,
        minWordSizefor2Typos: 7,
      });
      // Keep Algolia's prefix matching and word typo tolerance for models.
      expect(settings.get(indexName)?.queryType).toBeUndefined();
      expect(settings.get(indexName)).toMatchObject({
        searchableAttributes: [
          "make",
          "model",
          "unordered(sourceModel)",
          "year",
          "unordered(color)",
          "unordered(vin)",
          "unordered(vinPrefixes)",
        ],
        // Exact prefix tokens enforce the eight-character floor without
        // allowing shorter or mistyped VINs to match either VIN field.
        disablePrefixOnAttributes: ["vin", "vinPrefixes"],
        disableTypoToleranceOnAttributes: ["vin", "vinPrefixes"],
      });
    }
  });

  test("creates replicas before forwarding the VIN filtering settings", () => {
    const plan = buildAlgoliaSettingsPlan();
    const [oldestIndex, yearDescIndex, yearAscIndex, newestIndex] =
      ALGOLIA_REPLICA_INDEX_NAMES;

    expect(plan[0]).toEqual({
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
      "vinPrefixes",
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
      "vehicles_newest",
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
    "settings:vehicles_newest",
    "wait:vehicles_newest:7",
    "delete:vehicles_distance",
    "wait:vehicles_distance:8",
  ]);
});

test("failed settings tasks stop apply before deletion", async () => {
  const { client, calls } = settingsFixture(true);
  await expect(applyAlgoliaSettingsPlan(client)).rejects.toThrow(
    "settings task failed",
  );
  expect(calls).toEqual(["settings:vehicles", "wait:vehicles:1"]);
});

test("date sorts ignore model relevance and order known arrivals before unknown dates", () => {
  const plan = buildAlgoliaSettingsPlan();
  const records = [
    {
      id: "old",
      model: "HONDA CIVIC",
      arrivalDateKnown: 1,
      availableDateTs: Date.parse("2013-08-28") / 1000,
    },
    {
      id: "new",
      model: "CIVIC",
      arrivalDateKnown: 1,
      availableDateTs: Date.parse("2026-11-18") / 1000,
    },
    {
      id: "seen",
      model: "CIVIC",
      arrivalDateKnown: 1,
      availableDateTs: Date.parse("2026-11-17") / 1000,
    },
    {
      id: "unknown",
      model: "HONDA CIVIC",
      arrivalDateKnown: 0,
      availableDateTs: 0,
    },
  ];
  for (const [indexName, expected] of [
    ["vehicles_newest", ["new", "seen", "old", "unknown"]],
    ["vehicles_oldest", ["old", "seen", "new", "unknown"]],
  ] as const) {
    const operation = plan.find(
      (operation) =>
        operation.kind === "settings" && operation.indexName === indexName,
    );
    expect(operation?.kind).toBe("settings");
    if (operation?.kind !== "settings") continue;
    expect(operation.indexSettings.relevancyStrictness).toBe(0);
    expect(operation.indexSettings.customRanking).toEqual([
      "desc(arrivalDateKnown)",
      indexName === "vehicles_newest"
        ? "desc(availableDateTs)"
        : "asc(availableDateTs)",
    ]);
    const keys = operation.indexSettings.customRanking ?? [];
    const ordered = [...records].sort((left, right) => {
      for (const key of keys) {
        const field = key.includes("arrivalDateKnown")
          ? "arrivalDateKnown"
          : "availableDateTs";
        const difference = left[field] - right[field];
        if (difference)
          return key.startsWith("desc(") ? -difference : difference;
      }
      return 0;
    });
    expect(ordered.map((record) => record.id)).toEqual([...expected]);
  }
});

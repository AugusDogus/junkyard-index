import { describe, expect, test } from "bun:test";
import {
  AlgoliaAdminClientRefused,
  AlgoliaDeployment,
  PRODUCTION_ALGOLIA_APP_ID,
} from "./algolia-deployment";

const OTHER_APP_ID = "NONPROD123";

describe("AlgoliaDeployment.parse", () => {
  test.each([
    ["production", "production"],
    ["preview", "preview"],
    ["development", "development"],
    [undefined, "local"],
    ["", "local"],
    ["staging", "local"],
  ] as const)("VERCEL_ENV=%p is %p", (vercelEnv, deployment) => {
    expect(AlgoliaDeployment.parse(vercelEnv)).toBe(deployment);
  });
});

describe("AlgoliaDeployment.indexName", () => {
  test("production and local processes keep the base name", () => {
    expect(AlgoliaDeployment.indexName("production", "vehicles")).toBe(
      "vehicles",
    );
    expect(AlgoliaDeployment.indexName("local", "vehicles_newest")).toBe(
      "vehicles_newest",
    );
  });

  test("Vercel's other deployments get a prefix the production key's vehicles* restriction does not match", () => {
    expect(AlgoliaDeployment.indexName("preview", "vehicles")).toBe(
      "preview_vehicles",
    );
    expect(AlgoliaDeployment.indexName("development", "vehicles_oldest")).toBe(
      "development_vehicles_oldest",
    );
  });
});

describe("AlgoliaDeployment.adminAccess", () => {
  test.each(["preview", "development", "local"] as const)(
    "refuses the production app's write client to a %s process",
    (deployment) => {
      const access = AlgoliaDeployment.adminAccess(
        deployment,
        PRODUCTION_ALGOLIA_APP_ID,
      );
      if (access.kind !== "refused") {
        throw new Error(`Expected refusal, got ${access.kind}`);
      }
      expect(access.error).toBeInstanceOf(AlgoliaAdminClientRefused);
      expect(access.error.deployment).toBe(deployment);
      expect(access.error.message).toContain("production index is unchanged");
    },
  );

  test("allows production to write the production app", () => {
    expect(
      AlgoliaDeployment.adminAccess("production", PRODUCTION_ALGOLIA_APP_ID),
    ).toEqual({ kind: "allowed" });
  });

  test.each(["preview", "development", "local"] as const)(
    "allows a %s process to write a separate app",
    (deployment) => {
      expect(AlgoliaDeployment.adminAccess(deployment, OTHER_APP_ID)).toEqual({
        kind: "allowed",
      });
    },
  );
});

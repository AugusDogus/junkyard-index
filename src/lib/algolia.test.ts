import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { PRODUCTION_ALGOLIA_APP_ID } from "./algolia-deployment";

const reportSchema = z.object({
  constructedOnImport: z.number(),
  constructed: z.array(z.string()),
  result: z.string(),
  sameClient: z.boolean().optional(),
  indexName: z.string(),
  replicaIndexNames: z.array(z.string()),
});

// Index names are fixed when the modules load, so each deployment gets its own
// process, with the Algolia SDK replaced by one that records constructions.
function loadAlgolia(input: {
  vercelEnv?: string;
  publicVercelEnv?: string;
  appId: string;
}) {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.VERCEL_ENV;
  delete env.NEXT_PUBLIC_VERCEL_ENV;
  if (input.vercelEnv !== undefined) env.VERCEL_ENV = input.vercelEnv;
  if (input.publicVercelEnv !== undefined) {
    env.NEXT_PUBLIC_VERCEL_ENV = input.publicVercelEnv;
  }
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { mock } from "bun:test";
    const constructed = [];
    mock.module("server-only", () => ({}));
    mock.module("~/env", () => ({
      env: {
        NEXT_PUBLIC_ALGOLIA_APP_ID: ${JSON.stringify(input.appId)},
        ALGOLIA_WRITE_API_KEY: "write-key",
      },
    }));
    mock.module("algoliasearch", () => ({
      algoliasearch: (appId) => {
        constructed.push(appId);
        return { appId };
      },
    }));
    const algolia = await import("./src/lib/algolia.ts");
    const constants = await import("./src/lib/constants.ts");
    const report = {
      constructedOnImport: constructed.length,
      indexName: constants.ALGOLIA_INDEX_NAME,
      replicaIndexNames: [...constants.ALGOLIA_REPLICA_INDEX_NAMES],
    };
    try {
      const first = algolia.getAlgoliaAdminClient();
      report.sameClient = first === algolia.getAlgoliaAdminClient();
      report.result = "created";
    } catch (error) {
      report.result = error.name;
    }
    report.constructed = constructed;
    console.log(JSON.stringify(report));
  `,
    ],
    { cwd: process.cwd(), env },
  );
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  return reportSchema.parse(JSON.parse(result.stdout.toString()));
}

describe("getAlgoliaAdminClient", () => {
  test("builds the production app's client once, on first use, in production", () => {
    const report = loadAlgolia({
      vercelEnv: "production",
      appId: PRODUCTION_ALGOLIA_APP_ID,
    });
    expect(report.constructedOnImport).toBe(0);
    expect(report.result).toBe("created");
    expect(report.sameClient).toBe(true);
    expect(report.constructed).toEqual([PRODUCTION_ALGOLIA_APP_ID]);
  });

  test.each(["preview", "development", undefined])(
    "refuses the production app before building a client when VERCEL_ENV is %p",
    (vercelEnv) => {
      const report = loadAlgolia({
        vercelEnv,
        appId: PRODUCTION_ALGOLIA_APP_ID,
      });
      expect(report.result).toBe("AlgoliaAdminClientRefused");
      expect(report.constructed).toEqual([]);
    },
  );

  test("builds a separate app's client in a preview", () => {
    const report = loadAlgolia({ vercelEnv: "preview", appId: "NONPROD123" });
    expect(report.result).toBe("created");
    expect(report.constructed).toEqual(["NONPROD123"]);
  });
});

describe("Algolia index names", () => {
  test("production keeps vehicles and its replicas", () => {
    const report = loadAlgolia({
      vercelEnv: "production",
      appId: PRODUCTION_ALGOLIA_APP_ID,
    });
    expect(report.indexName).toBe("vehicles");
    expect(report.replicaIndexNames).toEqual([
      "vehicles_oldest",
      "vehicles_year_desc",
      "vehicles_year_asc",
      "vehicles_newest",
    ]);
  });

  test("the server's VERCEL_ENV prefixes a preview's names", () => {
    const report = loadAlgolia({ vercelEnv: "preview", appId: "NONPROD123" });
    expect(report.indexName).toBe("preview_vehicles");
    expect(report.replicaIndexNames).toContain("preview_vehicles_newest");
  });

  test("the browser's inlined NEXT_PUBLIC_VERCEL_ENV prefixes the same names", () => {
    const report = loadAlgolia({
      publicVercelEnv: "preview",
      appId: "NONPROD123",
    });
    expect(report.indexName).toBe("preview_vehicles");
  });

  test("an empty inlined value falls back to VERCEL_ENV", () => {
    const report = loadAlgolia({
      publicVercelEnv: "",
      vercelEnv: "development",
      appId: "NONPROD123",
    });
    expect(report.indexName).toBe("development_vehicles");
  });

  test("a process outside Vercel keeps the base names", () => {
    const report = loadAlgolia({ appId: "NONPROD123" });
    expect(report.indexName).toBe("vehicles");
  });
});

import { describe, expect, test } from "bun:test";
import type { Acl } from "algoliasearch";
import { z } from "zod";
import { AlgoliaDeployment } from "~/lib/algolia-deployment";
import { ALGOLIA_SEARCH_INDEX_NAMES, SEARCH_CONFIG } from "~/lib/constants";
import { AlgoliaApiKeySpec } from "./algolia-api-key-spec";

// The shape GET /1/keys/{key} returns for an unrestricted search key: Algolia
// leaves out every restriction that was never set.
const SHARED_KEY = {
  value: "0123456789abcdef0123456789abcdef",
  createdAt: 1771715553,
  acl: ["search", "listIndexes", "settings"] satisfies Acl[],
  validity: 0,
  description: "Search-Only API Key",
};

const SECURED_KEY = Buffer.from(
  `${"a".repeat(64)}restrictIndices=vehicles&validUntil=1`,
).toString("base64");

describe("AlgoliaApiKeySpec.forRole", () => {
  test("both roles can only search", () => {
    for (const role of AlgoliaApiKeySpec.roles) {
      expect(AlgoliaApiKeySpec.forRole(role).acl).toEqual(["search"]);
    }
  });

  test("both roles read every deployment's search indices and nothing else", () => {
    for (const role of AlgoliaApiKeySpec.roles) {
      const { indexes } = AlgoliaApiKeySpec.forRole(role);
      for (const name of ALGOLIA_SEARCH_INDEX_NAMES) {
        expect(indexes).toContain(name);
        expect(indexes).toContain(AlgoliaDeployment.indexName("preview", name));
        expect(indexes).toContain(
          AlgoliaDeployment.indexName("development", name),
        );
      }
      expect(indexes).toHaveLength(ALGOLIA_SEARCH_INDEX_NAMES.length * 3);
    }
  });

  test("the browser parent caps hits per query above a results page", () => {
    const { maxHitsPerQuery } = AlgoliaApiKeySpec.forRole("browser-parent");
    expect(maxHitsPerQuery).toBeGreaterThanOrEqual(
      SEARCH_CONFIG.FREE_VISIBLE_RESULTS_LIMIT,
    );
    // Direct API callers ask for 500 or 1,000 hits per query.
    expect(maxHitsPerQuery).toBeLessThan(500);
  });

  test("the browser parent rate limits each visitor well above real use", () => {
    const { maxQueriesPerIPPerHour } =
      AlgoliaApiKeySpec.forRole("browser-parent");
    // Nov 21-27, 2026 site peak: 104 calls (171 queries) from one IP in an hour.
    expect(maxQueriesPerIPPerHour).toBeGreaterThanOrEqual(171 * 2);
  });

  test.each(["preview", "development"])(
    "keeps production's indices when the shell has VERCEL_ENV=%p",
    (vercelEnv) => {
      // Index names are fixed when the modules load, so each env gets its
      // own process. A pulled .env.local can set VERCEL_ENV for the script.
      const env: Record<string, string | undefined> = {
        ...process.env,
        VERCEL_ENV: vercelEnv,
      };
      delete env.NEXT_PUBLIC_VERCEL_ENV;
      const result = Bun.spawnSync(
        [
          process.execPath,
          "--eval",
          `const { AlgoliaApiKeySpec } = await import("./src/server/algolia-api-key-spec.ts");
          console.log(JSON.stringify(AlgoliaApiKeySpec.forRole("server").indexes));`,
        ],
        { cwd: process.cwd(), env },
      );
      expect(result.stderr.toString()).toBe("");
      const indexes = z
        .array(z.string())
        .parse(JSON.parse(result.stdout.toString()));
      expect(indexes).toContain("vehicles");
      expect(indexes).toContain("vehicles_newest");
      expect(indexes).toContain("preview_vehicles");
      expect(indexes).toContain("development_vehicles");
      expect(indexes).toEqual([...AlgoliaApiKeySpec.forRole("server").indexes]);
    },
  );

  test("the server key has no per-IP limit, since functions share egress IPs", () => {
    const spec = AlgoliaApiKeySpec.forRole("server");
    expect(spec.maxQueriesPerIPPerHour).toBe(0);
    expect(spec.maxHitsPerQuery).toBe(0);
  });
});

describe("AlgoliaApiKeySpec.parse", () => {
  test("reads restrictions Algolia leaves out as their unlimited defaults", () => {
    expect(AlgoliaApiKeySpec.parse(SHARED_KEY)).toEqual({
      ...SHARED_KEY,
      indexes: [],
      maxHitsPerQuery: 0,
      maxQueriesPerIPPerHour: 0,
      queryParameters: "",
      referers: [],
    });
  });

  test("rejects an answer without a key value", () => {
    expect(() =>
      AlgoliaApiKeySpec.parse({ ...SHARED_KEY, value: undefined }),
    ).toThrow();
  });
});

describe("AlgoliaApiKeySpec.summary", () => {
  test("names the key by fingerprint and never carries its value", () => {
    const summary = AlgoliaApiKeySpec.summary(
      AlgoliaApiKeySpec.parse(SHARED_KEY),
    );
    expect(JSON.stringify(summary)).not.toContain(SHARED_KEY.value);
    expect(summary.fingerprint).toBe(
      AlgoliaApiKeySpec.fingerprint(SHARED_KEY.value),
    );
    expect(summary.fingerprint).toMatch(/^[0-9a-f]{10}$/);
    expect(summary.acl).toEqual(SHARED_KEY.acl);
  });
});

describe("AlgoliaApiKeySpec.retired and settingsOf", () => {
  const before = AlgoliaApiKeySpec.parse(SHARED_KEY);

  test("a retired key reads no index any deployment searches", () => {
    const retired = AlgoliaApiKeySpec.retired(
      before,
      new Date("2026-11-28T00:00:00Z"),
    );
    expect(retired.acl).toEqual(["search"]);
    for (const role of AlgoliaApiKeySpec.roles) {
      for (const name of AlgoliaApiKeySpec.forRole(role).indexes) {
        expect(retired.indexes).not.toContain(name);
      }
    }
    expect(retired.indexes.length).toBeGreaterThan(0);
    expect(retired.description).toContain("2026-11-28");
    expect(retired.description).toContain(SHARED_KEY.description);
  });

  test("refuses while browsers still receive a plain key", () => {
    const decision = AlgoliaApiKeySpec.retireDecision(before, SHARED_KEY.value);
    expect(decision.kind).toBe("refused");
  });

  test("refuses a key that can write", () => {
    const writer = AlgoliaApiKeySpec.parse({
      ...SHARED_KEY,
      acl: ["search", "addObject"],
    });
    const decision = AlgoliaApiKeySpec.retireDecision(writer, SECURED_KEY);
    expect(decision.kind).toBe("refused");
  });

  test.each([...AlgoliaApiKeySpec.roles])(
    "refuses the %p key this script created",
    (role) => {
      const created = AlgoliaApiKeySpec.parse({
        ...SHARED_KEY,
        ...AlgoliaApiKeySpec.forRole(role),
      });
      const decision = AlgoliaApiKeySpec.retireDecision(created, SECURED_KEY);
      expect(decision.kind).toBe("refused");
    },
  );

  test("allows the search key once browsers receive secured keys", () => {
    expect(AlgoliaApiKeySpec.retireDecision(before, SECURED_KEY)).toEqual({
      kind: "allowed",
    });
  });

  test("a written key matches Algolia's answer that omits unset limits and reorders lists", () => {
    const written = AlgoliaApiKeySpec.settingsOf(before);
    const answer = AlgoliaApiKeySpec.parse({
      ...SHARED_KEY,
      acl: [...SHARED_KEY.acl].reverse(),
    });
    expect(AlgoliaApiKeySpec.hasSettings(answer, written)).toBe(true);
    const retired = AlgoliaApiKeySpec.retired(before, new Date());
    expect(AlgoliaApiKeySpec.hasSettings(answer, retired)).toBe(false);
  });

  test("restoring writes back exactly the settings the key had", () => {
    expect(AlgoliaApiKeySpec.settingsOf(before)).toEqual({
      acl: SHARED_KEY.acl,
      description: SHARED_KEY.description,
      indexes: [],
      maxHitsPerQuery: 0,
      maxQueriesPerIPPerHour: 0,
      queryParameters: "",
      referers: [],
      validity: 0,
    });
  });
});

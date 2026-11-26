import { expect, test } from "bun:test";

/**
 * Runs `scenario` in a child process with the yard page's data sources
 * mocked, and records each data-cache read by its key. Prints the JSON the
 * scenario logs.
 */
function run(scenario: string): unknown {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { mock } from "bun:test";
    globalThis.cacheReads = [];
    globalThis.directoryReads = 0;
    const entries = new Map();
    mock.module("server-only", () => ({}));
    mock.module("next/cache", () => ({
      unstable_cache: (load, keyParts) => async (...args) => {
        globalThis.cacheReads.push(keyParts[0]);
        const key = JSON.stringify([...keyParts, ...args]);
        if (!entries.has(key)) entries.set(key, await load(...args));
        return structuredClone(entries.get(key));
      },
    }));
    mock.module("~/server/source-control/hidden-sources", () => ({
      loadHiddenSources: async () => ({ list: [] }),
    }));
    const { YardPath } = await import("./src/lib/yard-path.ts");
    const yard = (source, code, name, city, state, lat, lng) => ({
      source, code, name, city, state, lat, lng, vehicleCount: 10, operator: null,
    });
    const yards = [
      yard("pyp", "1", "LKQ Pick Your Part - Tulsa", "Tulsa", "OK", 36.1, -95.9),
      yard("pyp", "2", "LKQ Pick Your Part - Oklahoma City", "Oklahoma City", "OK", 35.4, -97.5),
      yard("row52", "7", "Granite Pull", "Broken Arrow", "OK", 36.05, -95.8),
      yard("row52", "9", "Far Away", "Denver", "CO", 39.7, -105),
    ];
    mock.module("~/server/homepage-yards", () => ({
      getHomepageYards: async () => {
        globalThis.directoryReads++;
        const paths = YardPath.assign(yards);
        return yards.map((entry) => ({ ...entry, path: paths.get(YardPath.key(entry)) ?? null }));
      },
    }));
    mock.module("~/server/ingestion/durable-health", () => ({
      loadSourceFreshness: async () => [],
      loadSourcePublishedAt: async (_db, _now, source) =>
        source === "pyp" ? Date.parse("2026-11-26T08:00:00Z") : null,
    }));
    mock.module("~/lib/db", () => ({
      db: {
        select: () => ({
          from: () => ({
            where: async () => [{ source: "pyp", code: "1", lastCheckedAt: new Date("2026-11-26T07:00:00Z") }],
          }),
        }),
      },
    }));
    mock.module("~/server/yard-summary-store", () => ({
      YardSummaryStore: {
        read: async () => ({ fingerprint: "f", total: 10, makes: [], arrivals: [], makeLists: [] }),
      },
    }));
    const inventory = await import("./src/server/yard-inventory.ts");
    const tulsa = YardPath.assign(yards).get(YardPath.key(yards[0]));
    ${scenario}
  `,
    ],
    { cwd: process.cwd(), env: { ...process.env, SKIP_ENV_VALIDATION: "1" } },
  );
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout.toString());
}

test("a yard page reads its region's routes, its context and its summary, never the directory entry", () => {
  expect(
    run(`
    const data = await inventory.getYardPageData(tulsa.region.slug, tulsa.slug);
    console.log(JSON.stringify({
      yard: data.yard.name,
      nearby: data.nearby.map((entry) => entry.yard.name),
      chain: data.chain?.yards ?? null,
      publishedAt: data.publishedAt,
      checkedAt: data.checkedAt,
      checkUnknown: data.checkUnknown,
      total: data.summary.total,
      // React's cache() dedupes the hidden list only inside a render.
      reads: [...new Set(globalThis.cacheReads)].sort(),
    }));
  `),
  ).toEqual({
    yard: "LKQ Pick Your Part - Tulsa",
    nearby: ["Granite Pull", "LKQ Pick Your Part - Oklahoma City", "Far Away"],
    chain: 2,
    publishedAt: "2026-11-26T07:00:00.000Z",
    checkedAt: "2026-11-26T07:00:00.000Z",
    checkUnknown: false,
    total: 10,
    reads: [
      "hidden-sources-v2",
      "yard-context-v1",
      "yard-routes-v1",
      "yard-summary-v5",
    ],
  });
});

test("an unknown region or yard reads no cache entry for the yard", () => {
  expect(
    run(`
    const garbage = await inventory.getYardPageData("not-a-region", tulsa.slug);
    const before = globalThis.cacheReads.length;
    const missing = await inventory.getYardPageData(tulsa.region.slug, "no-such-yard");
    const constructor = await inventory.getYardPageData(tulsa.region.slug, "constructor");
    console.log(JSON.stringify({
      garbage,
      garbageReads: before,
      missing,
      constructor,
      reads: [...new Set(globalThis.cacheReads)].sort(),
    }));
  `),
  ).toEqual({
    garbage: null,
    garbageReads: 0,
    missing: null,
    constructor: null,
    reads: ["hidden-sources-v2", "yard-routes-v1"],
  });
});

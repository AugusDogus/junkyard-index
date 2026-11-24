import { describe, expect, test } from "bun:test";

/**
 * Runs `steps` in a child process, so the module mocks stay out of other
 * test files. The next/cache mock keys entries by key parts and arguments,
 * like unstable_cache, and `expire(tag)` drops every entry with that tag, as
 * the admin's `updateTag` does. The inventory tag is never expired here: a
 * publish expires it with stale-while-revalidate, so an older entry can
 * still be served, and only the source-control tag follows a hide or show.
 */
function run(steps: string): unknown {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { mock } from "bun:test";
    const entries = new Map();
    mock.module("server-only", () => ({}));
    mock.module("next/cache", () => ({
      unstable_cache: (load, keyParts, options) => async (...args) => {
        const key = JSON.stringify([...keyParts, ...args]);
        if (!entries.has(key)) {
          entries.set(key, { value: await load(...args), tags: options?.tags ?? [] });
        }
        return structuredClone(entries.get(key).value);
      },
    }));
    globalThis.expire = (tag) => {
      for (const [key, entry] of entries) {
        if (entry.tags.includes(tag)) entries.delete(key);
      }
    };
    const { HiddenSources } = await import("./src/lib/hidden-source.ts");
    const { YardPath } = await import("./src/lib/yard-path.ts");
    // What the database holds now: yards with live inventory, new arrivals
    // per yard, and the hidden sources.
    globalThis.yards = [];
    globalThis.hidden = [];
    const shown = (source, list) => !HiddenSources.has(HiddenSources.of(list), source);
    mock.module("~/lib/db", () => ({ db: {} }));
    mock.module("~/server/source-control/hidden-sources", () => ({
      loadHiddenSources: async () => HiddenSources.of(globalThis.hidden),
    }));
    mock.module("~/server/homepage-yards", () => ({
      getHomepageYards: async (_db, list) => {
        const listed = globalThis.yards
          .filter((yard) => shown(yard.source, list.list))
          .map(({ arrivals, ...yard }) => yard);
        const paths = YardPath.assign(listed);
        return listed.map((yard) => ({ ...yard, path: paths.get(YardPath.key(yard)) ?? null }));
      },
    }));
    mock.module("~/server/homepage-recent-vehicles", () => ({
      getRecentHomepageVehicles: async () => [],
    }));
    mock.module("~/server/state-new-arrivals", () => ({
      StateNewArrivals: {
        counts: async (_db, list) => {
          const counts = {};
          for (const yard of globalThis.yards) {
            if (shown(yard.source, list.list)) {
              counts[yard.state] = (counts[yard.state] ?? 0) + yard.arrivals;
            }
          }
          return counts;
        },
      },
    }));
    const inventory = await import("./src/server/yard-inventory.ts");
    const { getHomepageInventory } = await import("./src/lib/homepage-inventory.ts");
    const { SOURCE_CONTROL_CACHE_TAG } = await import("./src/server/source-control/hidden-sources-loader.ts");
    const yard = (source, code, name, city, state, arrivals) => ({
      source, code, name, city, state, arrivals, operator: null,
      lat: 43, lng: -71, vehicleCount: 100,
    });
    globalThis.sixO3 = [
      yard("six03", "1", "603 Auto Salvage - Concord", "Concord", "NH", 5),
      yard("six03", "2", "603 Auto Salvage - Nashua", "Nashua", "NH", 3),
    ];
    globalThis.granite = yard("row52", "7", "Granite Pull", "Keene", "NH", 2);
    // What each listing shows, by yard key, after only the source-control
    // tag expires.
    globalThis.listings = async () => {
      const names = (list) => list.map((entry) => YardPath.key(entry)).sort();
      const region = await inventory.findRegionYards("new-hampshire");
      const chain = await inventory.findChain("603-auto-salvage");
      return {
        directory: names(await inventory.getYardDirectory()),
        state: region ? names(region.yards) : null,
        stateNew: await inventory.getRegionNewCount("NH"),
        chain: chain ? names(chain.yards) : null,
        homepage: names((await getHomepageInventory()).yards),
      };
    };
    globalThis.change = (next) => {
      globalThis.yards = next.yards;
      globalThis.hidden = next.hidden;
      expire(SOURCE_CONTROL_CACHE_TAG);
    };
    ${steps}
  `,
    ],
    { cwd: process.cwd(), env: { ...process.env, SKIP_ENV_VALIDATION: "1" } },
  );
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout.toString());
}

const SIX03 = ["six03:1", "six03:2"];

describe("hiding or showing a source", () => {
  test("a show lists the source after only the source-control tag expires", () => {
    expect(
      run(`
      // Cached while 603 was shown but had not published yet.
      change({ yards: [granite], hidden: [] });
      await listings();
      // 603 publishes while hidden.
      change({ yards: [granite, ...sixO3], hidden: ["six03"] });
      await listings();
      change({ yards: [granite, ...sixO3], hidden: [] });
      console.log(JSON.stringify(await listings()));
    `),
    ).toEqual({
      directory: ["row52:7", ...SIX03],
      state: ["row52:7", ...SIX03],
      stateNew: 10,
      chain: SIX03,
      homepage: ["row52:7", ...SIX03],
    });
  });

  test("a hide drops the source after only the source-control tag expires", () => {
    expect(
      run(`
      // Cached while 603 was hidden, before Granite published.
      change({ yards: [...sixO3], hidden: ["six03"] });
      await listings();
      change({ yards: [granite, ...sixO3], hidden: [] });
      await listings();
      change({ yards: [granite, ...sixO3], hidden: ["six03"] });
      console.log(JSON.stringify(await listings()));
    `),
    ).toEqual({
      directory: ["row52:7"],
      state: ["row52:7"],
      stateNew: 2,
      chain: null,
      homepage: ["row52:7"],
    });
  });
});

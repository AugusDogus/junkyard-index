import { expect, test } from "bun:test";

/**
 * Resolves Chevrolet Silverado for a yard's model page twice, with
 * Chevrolet's live count changing in between (a publication), and prints
 * the data-cache keys the model-name entry was read under. Runs in its own
 * process so the module mocks stay out of other test files.
 */
function modelNameKeys(): string[] {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { mock } from "bun:test";
    const keys = [];
    mock.module("server-only", () => ({}));
    mock.module("next/cache", () => ({
      unstable_cache: (load, keyParts) => async (...args) => {
        if (keyParts[0].startsWith("make-model-name")) keys.push(JSON.stringify(args));
        return load(...args);
      },
    }));
    mock.module("~/lib/db", () => ({ db: {} }));
    mock.module("~/server/source-control/hidden-sources", () => ({
      loadHiddenSources: async () => ({ list: [] }),
    }));
    mock.module("~/server/yard-inventory", () => ({ getRoutedYards: async () => [] }));
    globalThis.chevrolets = 100;
    mock.module("~/server/inventory-snapshot", () => ({
      InventorySnapshot: {
        makeCounts: async () => [{ make: "Chevrolet", count: globalThis.chevrolets }],
        makeModels: async () => [
          { source: "pyp", code: "1", make: "Chevrolet", model: "Silverado", count: 3, minYear: 2001, maxYear: 2009 },
        ],
      },
    }));
    const models = await import("./src/server/vehicle-models.ts");
    const first = await models.getYardModelPageData("chevrolet", "silverado");
    globalThis.chevrolets = 101;
    const second = await models.getYardModelPageData("chevrolet", "silverado");
    if (first?.model.key !== second?.model.key) throw new Error("model changed");
    console.log(JSON.stringify(keys));
  `,
    ],
    { cwd: process.cwd(), env: { ...process.env, SKIP_ENV_VALIDATION: "1" } },
  );
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  const keys: string[] = JSON.parse(result.stdout.toString());
  return keys;
}

test("a yard model page's model lookup keeps its cache key when the make's count changes", () => {
  const keys = modelNameKeys();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

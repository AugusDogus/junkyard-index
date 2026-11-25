import { describe, expect, test } from "bun:test";

const MODULE = new URL("./inventory-cache.ts", import.meta.url).pathname;
const EXPIRY_MODULE = new URL("./inventory-cache-expiry.ts", import.meta.url)
  .pathname;

/**
 * Runs a cached inventory loader whose first `failures` reads fail with
 * Turso's HTTP `status`, in a child process with next/cache passed through
 * so the mock stays out of other test files. Resolves what the loader
 * returned (or the error it threw) and how many reads ran.
 */
async function load(failures: number, status: number) {
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
      import { mock } from "bun:test";
      mock.module("next/cache", () => ({ unstable_cache: (load) => load }));
      const { LibsqlError } = await import("@libsql/client/web");
      const { DrizzleQueryError } = await import("drizzle-orm");
      const { cacheInventory } = await import(${JSON.stringify(MODULE)});
      let reads = 0;
      const cached = cacheInventory(async (yard) => {
        reads += 1;
        if (reads <= ${failures}) {
          const cause = Object.assign(new Error("Server returned HTTP status ${status}"), { status: ${status} });
          // Drizzle wraps every failed query, as in production.
          throw new DrizzleQueryError("select", [], new LibsqlError(cause.message, "SERVER_ERROR", undefined, undefined, cause));
        }
        return yard + " rows";
      }, ["test"]);
      const result = await cached("modesto").then(
        (value) => ({ value }),
        (error) => ({ error: error.cause.message }),
      );
      console.log(JSON.stringify({ ...result, reads }));
    `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`child exited ${exitCode}: ${errors}`);
  const parsed: unknown = JSON.parse(output.trim().split("\n").at(-1) ?? "");
  return parsed;
}

describe("cacheInventory", () => {
  test("a one-off Turso 502 is retried instead of failing the page", async () => {
    expect(await load(1, 502)).toEqual({ value: "modesto rows", reads: 2 });
  });

  test("a sustained outage still fails after bounded retries", async () => {
    expect(await load(5, 502)).toEqual({
      error: "SERVER_ERROR: Server returned HTTP status 502",
      reads: 3,
    });
  });

  test("a non-gateway server error is not retried", async () => {
    expect(await load(1, 400)).toEqual({
      error: "SERVER_ERROR: Server returned HTTP status 400",
      reads: 1,
    });
  });
});

/** Runs `script` in a child with next/cache recording each call. */
async function withRecordedCache(script: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
      import { mock } from "bun:test";
      const calls = [];
      mock.module("next/cache", () => ({
        unstable_cache: (load, keyParts, options) => async (...args) => {
          calls.push({ keyParts, tags: options.tags, args });
          return load(...args);
        },
        revalidateTag: (tag, profile) => calls.push({ revalidate: tag, profile }),
      }));
      const cache = {
        ...(await import(${JSON.stringify(MODULE)})),
        ...(await import(${JSON.stringify(EXPIRY_MODULE)})),
      };
      ${script}
      console.log(JSON.stringify(calls));
    `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`child exited ${exitCode}: ${errors}`);
  const parsed: unknown = JSON.parse(output.trim().split("\n").at(-1) ?? "");
  return parsed;
}

describe("cacheSourceInventory", () => {
  test("tags each entry with its source, not the inventory tag", async () => {
    expect(
      await withRecordedCache(`
        const cached = cache.cacheSourceInventory(
          async (source, code) => source + ":" + code,
          ["yard-test-v1"],
        );
        await cached("pyp", "1");
        await cached("row52", "5");
      `),
    ).toEqual([
      {
        keyParts: ["yard-test-v1"],
        tags: ["inventory-sources", "inventory-source:pyp"],
        args: ["pyp", "1"],
      },
      {
        keyParts: ["yard-test-v1"],
        tags: ["inventory-sources", "inventory-source:row52"],
        args: ["row52", "5"],
      },
    ]);
  });
});

describe("expireInventoryCaches", () => {
  test("expires the inventory tag and only the changed sources", async () => {
    expect(
      await withRecordedCache(`
        cache.expireInventoryCaches({ kind: "sources", sources: ["pyp", "calton"] });
      `),
    ).toEqual([
      { revalidate: "daily-inventory", profile: "max" },
      { revalidate: "inventory-source:pyp", profile: "max" },
      { revalidate: "inventory-source:calton", profile: "max" },
    ]);
  });

  test("expires every source's entries when all may have changed", async () => {
    expect(
      await withRecordedCache(`cache.expireInventoryCaches({ kind: "all" });`),
    ).toEqual([
      { revalidate: "daily-inventory", profile: "max" },
      { revalidate: "inventory-sources", profile: "max" },
    ]);
  });
});

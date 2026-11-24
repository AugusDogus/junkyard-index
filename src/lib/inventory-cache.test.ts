import { describe, expect, test } from "bun:test";

const MODULE = new URL("./inventory-cache.ts", import.meta.url).pathname;

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
      const { cacheInventory } = await import(${JSON.stringify(MODULE)});
      let reads = 0;
      const cached = cacheInventory(async (yard) => {
        reads += 1;
        if (reads <= ${failures}) {
          const cause = Object.assign(new Error("Server returned HTTP status ${status}"), { status: ${status} });
          throw new LibsqlError(cause.message, "SERVER_ERROR", undefined, undefined, cause);
        }
        return yard + " rows";
      }, ["test"]);
      const result = await cached("modesto").then(
        (value) => ({ value }),
        (error) => ({ error: error.message }),
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

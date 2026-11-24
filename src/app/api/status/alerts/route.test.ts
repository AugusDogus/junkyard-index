import { expect, test } from "bun:test";

const ROUTE = new URL("./route.ts", import.meta.url).pathname;

/**
 * Calls GET /api/status/alerts while its status read fails `failures` times
 * with a Turso HTTP 502, in a child process so the module mocks stay out of
 * other test files. Resolves the response status and how many reads ran.
 */
async function check(failures: number) {
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
      import { mock } from "bun:test";
      const { LibsqlError } = await import("@libsql/client/web");
      let reads = 0;
      mock.module("~/lib/db", () => ({ db: {} }));
      mock.module("~/server/alerts/search-alerts-flag", () => ({
        SearchAlertsFlag: { mode: async () => "disabled" },
      }));
      mock.module("~/server/alerts/durable-alert-delivery-runtime", () => ({
        DELIVERY_LEASE_MS: 1000,
      }));
      const { AlertStatus } = await import("~/server/alerts/alert-status");
      mock.module("~/server/alerts/alert-status", () => ({
        AlertStatus: {
          ...AlertStatus,
          load: async (_db, _now, mode) => {
            reads += 1;
            if (reads <= ${failures}) {
              const cause = Object.assign(new Error("Server returned HTTP status 502"), { status: 502 });
              throw new LibsqlError(cause.message, "SERVER_ERROR", undefined, undefined, cause);
            }
            return { mode, lastCompletedDay: null, openedChecks: [], oldestDeliverableAt: null };
          },
        },
      }));
      const { GET } = await import(${JSON.stringify(ROUTE)});
      const result = await GET().then(
        (response) => ({ status: response.status }),
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

test("a one-off Turso 502 while reading alert status is retried, not a 500", async () => {
  expect(await check(1)).toEqual({ status: 200, reads: 2 });
});

test("a sustained Turso outage still fails the check after bounded retries", async () => {
  expect(await check(5)).toEqual({
    error: "SERVER_ERROR: Server returned HTTP status 502",
    reads: 3,
  });
});

import { expect, test } from "bun:test";

// Runs in its own process: the module keeps load state, and the test stubs a
// browser window for one host and mocks the Sentry SDK.
function reportFrom(hostname: string) {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { mock } from "bun:test";
    const events = [];
    const listeners = {};
    globalThis.window = {
      location: { hostname: ${JSON.stringify(hostname)} },
      addEventListener: (type, listener) => { listeners[type] = listener; },
      removeEventListener: (type) => { delete listeners[type]; },
    };
    mock.module("@sentry/nextjs", () => ({
      init: () => events.push("init"),
      captureException: (error) => events.push("capture " + error.message),
    }));
    const { ErrorReporting } = await import("./src/lib/error-reporting.ts");
    ErrorReporting.start();
    events.push("listening " + Object.keys(listeners).sort().join(","));
    listeners.error?.({ error: new Error("uncaught") });
    ErrorReporting.capture(new Error("caught"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    console.log(JSON.stringify(events));
  `,
    ],
    { cwd: process.cwd() },
  );
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  const events: unknown = JSON.parse(result.stdout.toString());
  return events;
}

test("the live site loads Sentry and reports errors", () => {
  expect(reportFrom("junkyardindex.com")).toEqual([
    "listening error,unhandledrejection",
    "init",
    "capture uncaught",
    "capture caught",
  ]);
});

test.each([
  "my-branch.junkyard-index.localhost",
  "shared-search.test",
  "localhost",
  "junkyard-index-git-main.vercel.app",
])("%s never loads Sentry", (hostname) => {
  expect(reportFrom(hostname)).toEqual(["listening "]);
});

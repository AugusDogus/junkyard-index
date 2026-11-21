import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The workflow runtime's sleep is faked in its own process, since module
// mocks leak across the suite.
const SCRIPT = `
  import { mock } from "bun:test";
  const slept = [];
  mock.module("workflow", () => ({
    sleep: async (duration) => {
      slept.push(duration);
    },
  }));
  const { waitForPublicationMode, PUBLICATION_MODE_RETRY_DELAY } = await import(
    "./src/workflows/publication-mode-wait.ts"
  );
  await waitForPublicationMode();
  console.log(JSON.stringify({ slept, delay: PUBLICATION_MODE_RETRY_DELAY }));
`;

test("waiting for an unreadable publication mode sleeps the workflow one minute", () => {
  const result = Bun.spawnSync([process.execPath, "--eval", SCRIPT], {
    cwd: process.cwd(),
    env: { ...process.env, SKIP_ENV_VALIDATION: "1" },
  });
  expect({
    exitCode: result.exitCode,
    stderr: result.exitCode === 0 ? "" : result.stderr.toString(),
  }).toEqual({ exitCode: 0, stderr: "" });
  expect(
    JSON.parse(result.stdout.toString().trim().split("\n").at(-1) ?? "null"),
  ).toEqual({ slept: ["1m"], delay: "1m" });
});

test("the source run workflow waits with it while reconciling and while projecting", () => {
  // Both call sites live inside one workflow function, which unit tests
  // cannot run, so the wiring is pinned in the source: each passes the
  // shared wait, and nothing defines its own.
  const source = readFileSync(
    new URL("./vehicle-ingestion.ts", import.meta.url),
    "utf8",
  );
  expect(source).toContain(
    'import { waitForPublicationMode } from "./publication-mode-wait";',
  );
  expect(source.match(/^\s*waitForPublicationMode,$/gm)).toHaveLength(2);
  expect(source.match(/waitForPublicationMode\s*:/g)).toBeNull();
});

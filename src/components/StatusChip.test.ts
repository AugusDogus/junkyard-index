import { expect, test } from "bun:test";

const MODULE = new URL("./StatusChip.tsx", import.meta.url).pathname;

/**
 * Reads the status chip's state while status.junkyardindex.com answers with
 * `answer`, in a child process with next/cache and fetch mocked so the mocks
 * stay out of other test files.
 */
async function read(answer: "operational" | "unreachable"): Promise<unknown> {
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
      import { mock } from "bun:test";
      let cache = null;
      mock.module("next/cache", () => ({
        unstable_cache: (load, keyParts, options) => {
          cache = { keyParts, options };
          return load;
        },
      }));
      let request = null;
      globalThis.fetch = async (_url, init) => {
        request = { cache: init?.cache, next: init?.next, hasSignal: init?.signal instanceof AbortSignal };
        if (${JSON.stringify(answer)} === "unreachable") {
          throw new TypeError("fetch failed", { cause: new Error("ConnectTimeoutError") });
        }
        return Response.json({ data: { attributes: { aggregate_state: "operational" } } });
      };
      let logged = 0;
      console.error = () => { logged += 1; };
      const { getAggregateState } = await import(${JSON.stringify(MODULE)});
      const state = await getAggregateState("https://status.example/");
      process.stdout.write(JSON.stringify({ state, cache, request, logged }) + "\\n");
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

test("the status state is cached by unstable_cache, not by a revalidating fetch", async () => {
  // Next revalidates a stale cached fetch in the background without its
  // abort signal and logs the failure, so the request must bypass the fetch
  // cache and keep its own timeout on every read.
  expect(await read("operational")).toEqual({
    state: { dot: "bg-success", label: "All systems operational" },
    cache: {
      keyParts: ["status-chip-state-v1"],
      options: { revalidate: 300 },
    },
    request: { cache: "no-store", next: undefined, hasSignal: true },
    logged: 0,
  });
});

test("an unreachable status page shows the plain label without logging", async () => {
  expect(await read("unreachable")).toMatchObject({ state: null, logged: 0 });
});

import { expect, test } from "bun:test";

test("the request page renders without reading the request, so the CDN serves it", async () => {
  // Isolate framework mocks from other test files in the same Bun shard.
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
      import { mock } from "bun:test";
      mock.module("~/lib/auth", () => ({ auth: { api: { getSession: async () => { throw new Error("read the session"); } } } }));
      mock.module("next/headers", () => ({ headers: async () => { throw new Error("read headers"); }, cookies: async () => { throw new Error("read cookies"); } }));
      mock.module("~/components/PageShell", () => ({ PageShell: (props) => props }));
      mock.module("~/components/request-yard/RequestYardForm", () => ({ RequestYardForm: () => null }));
      const { default: page } = await import(${JSON.stringify(new URL("./page.tsx", import.meta.url).pathname)});
      const shell = await page();
      process.stdout.write(JSON.stringify({ rendering: shell.props.rendering }));
    `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(errors).toBe("");
  expect(exitCode).toBe(0);
  // The static shell loads the session in the browser and links the status page.
  expect(output).toBe(JSON.stringify({ rendering: "static" }));
});

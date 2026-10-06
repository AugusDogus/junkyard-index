import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export async function bundleSharedSearchFixture(target: "bun" | "browser") {
  const build = await Bun.build({
    entrypoints: ["tests/browser/fixtures/shared-search.tsx"],
    target,
    define: { "process.env.NODE_ENV": '"production"' },
    // Keep the real search components and Next routing; replace only external services.
    plugins: [
      {
        name: "search-services",
        setup(builder) {
          builder.onLoad({ filter: /src\/env\.js$/ }, () => ({
            contents:
              'export const env = {NEXT_PUBLIC_APP_URL:"http://shared-search.test"};',
            loader: "js",
          }));
          builder.onResolve({ filter: /^algoliasearch\/lite$/ }, () => ({
            path: resolve("tests/browser/fixtures/shared-search-client.ts"),
          }));
          builder.onLoad({ filter: /next\/headers\.js$/ }, () => ({
            contents:
              'export function headers() { return new Headers({host:"shared-search.test"}); }',
            loader: "js",
          }));
        },
      },
    ],
  });
  const output = build.outputs[0];
  if (!build.success || !output) {
    throw new Error(`Could not bundle shared search: ${build.logs.join("\n")}`);
  }
  return output;
}

export async function renderSharedSearchFixture(
  searchParams = "q=toyota+venza&states=Alabama",
) {
  const directory = await mkdtemp(join(tmpdir(), "shared-search-"));
  try {
    const path = join(directory, "server.mjs");
    await Bun.write(path, await bundleSharedSearchFixture("bun"));
    const result = Bun.spawn(["bun", path, searchParams], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
    });
    const [html, errors, status] = await Promise.all([
      new Response(result.stdout).text(),
      new Response(result.stderr).text(),
      result.exited,
    ]);
    if (status !== 0)
      throw new Error(`Could not render shared search: ${errors}`);
    return html;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

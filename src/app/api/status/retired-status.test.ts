import { expect, test } from "bun:test";

// Isolate module mocks so the full suite still exercises real ingestion code.
test("retired source status is 503 without reading cached publication state", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { mock } from "bun:test";
    mock.module("next/cache", () => ({ unstable_cache: (load) => load }));
    mock.module("~/server/ingestion/source-freshness", () => ({
      getSourceFreshness: () => { throw new Error("Retired status must not query publication state"); },
    }));
    const { GET } = await import("./src/app/api/status/[source]/route.ts");
    for (const source of ["upullitne", "brandywine"]) {
      const response = await GET(new Request("https://example.com/api/status/" + source), { params: Promise.resolve({ source }) });
      console.log(response.status, response.headers.get("Cache-Control"), await response.text());
    }
  `,
    ],
    { cwd: process.cwd() },
  );
  expect(result.exitCode).toBe(0);
  const lines = result.stdout.toString().trim().split("\n");
  expect(lines).toHaveLength(2);
  for (const line of lines) {
    expect(line).toStartWith("503 no-store ");
    expect(line).toContain('"fresh":false');
    expect(line).toContain('"retired":true');
  }
});

import { expect, test } from "bun:test";
import { ACTIVE_INGESTION_SOURCES } from "~/lib/ingestion-source";

// Isolate module mocks so the full suite still exercises real ingestion code.
function statusFor(published: Record<string, number>, paused: string[]) {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { mock } from "bun:test";
    const published = ${JSON.stringify(published)};
    const paused = ${JSON.stringify(paused)};
    const sources = ${JSON.stringify(ACTIVE_INGESTION_SOURCES)};
    mock.module("next/cache", () => ({ unstable_cache: (load) => load }));
    mock.module("~/server/ingestion/source-freshness", () => ({
      getSourceFreshness: async () =>
        Object.entries(published).map(([source, hoursAgo]) => ({
          source,
          lastAttemptAt: Date.now(),
          lastPublishedAt: Date.now() - hoursAgo * 60 * 60 * 1000,
        })),
    }));
    mock.module("~/server/ingestion/ingestion-source-flags", () => ({
      IngestionSourceFlags: {
        enabledSources: async () => sources.filter((source) => !paused.includes(source)),
      },
    }));
    const { GET } = await import("./src/app/api/status/route.ts");
    const response = await GET();
    console.log(JSON.stringify({
      status: response.status,
      cacheControl: response.headers.get("Cache-Control"),
      body: await response.json(),
    }));
  `,
    ],
    { cwd: process.cwd() },
  );
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  const parsed: unknown = JSON.parse(result.stdout.toString());
  return parsed;
}

const allFresh = Object.fromEntries(
  ACTIVE_INGESTION_SOURCES.map((source) => [source, 3]),
);
const withoutAero = Object.fromEntries(
  Object.entries(allFresh).filter(([source]) => source !== "aero"),
);

test("all-sources status is 200 when every active source is fresh", () => {
  expect(statusFor(allFresh, [])).toEqual({
    status: 200,
    cacheControl: "no-store",
    body: {
      status: "healthy",
      staleAfterHours: 36,
      checked: ACTIVE_INGESTION_SOURCES.length,
      paused: [],
      stale: [],
    },
  });
});

test("all-sources status is 503 and lists stale sources", () => {
  expect(statusFor({ ...withoutAero, pyp: 40 }, [])).toMatchObject({
    status: 503,
    body: {
      status: "stale",
      stale: [
        {
          source: "pyp",
          name: "LKQ Pick Your Part",
          lastPublishedAt: expect.any(String),
        },
        { source: "aero", name: "Aero Auto Parts", lastPublishedAt: null },
      ],
    },
  });
});

test("all-sources status ignores a paused source", () => {
  expect(statusFor(withoutAero, ["aero"])).toMatchObject({
    status: 200,
    body: { status: "healthy", paused: ["aero"], stale: [] },
  });
});

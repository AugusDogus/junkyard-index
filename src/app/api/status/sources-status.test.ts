import { expect, test } from "bun:test";
import { ACTIVE_INGESTION_SOURCES } from "~/lib/ingestion-source";

// Isolate module mocks so the full suite still exercises real ingestion code.
type YardRow = {
  source: string;
  locationCode: string;
  vehicleCount: number;
  outcome: string | null;
  lastCheckedHoursAgo: number | null;
  lastChangedHoursAgo: number | null;
  consecutiveUncheckedRuns: number;
};

function statusFor(
  published: Record<string, number>,
  paused: string[],
  pausedHere: string[] | "read fails" = [],
  yards: YardRow[] | "read fails" = [],
) {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { mock } from "bun:test";
    const published = ${JSON.stringify(published)};
    const paused = ${JSON.stringify(paused)};
    const pausedHere = ${JSON.stringify(pausedHere)};
    const yards = ${JSON.stringify(yards)};
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
    mock.module("~/lib/db", () => ({ db: {} }));
    mock.module("~/server/ingestion/yard-check-rows", () => ({
      loadYardCheckRows: async () => {
        if (yards === "read fails") throw new Error("SQLITE_BUSY: yard_check");
        const hoursAgo = (hours) =>
          hours === null ? null : Date.now() - hours * 60 * 60 * 1000;
        return yards.map(({ lastCheckedHoursAgo, lastChangedHoursAgo, ...row }) => ({
          ...row,
          lastCheckedAt: hoursAgo(lastCheckedHoursAgo),
          lastChangedAt: hoursAgo(lastChangedHoursAgo),
        }));
      },
    }));
    const { SourceControl } = await import("./src/server/source-control/source-control.ts");
    mock.module("~/server/source-control/source-control-repository", () => ({
      SourceControlRepository: {
        all: async () => {
          if (pausedHere === "read fails") {
            throw new Error("SQLITE_BUSY: database is locked");
          }
          return SourceControl.fromRows(
            pausedHere.map((source) => ({
              source,
              ingestion: "paused",
              visibility: "shown",
              hiddenReason: null,
              updatedByUserId: "owner",
              updatedAt: new Date(),
            })),
          );
        },
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
      outageAfterStale: Math.ceil(ACTIVE_INGESTION_SOURCES.length * 0.2),
      paused: [],
      stale: [],
      yards: {
        status: "ok",
        staleAfterHours: 36,
        checked: 0,
        notChecked: [],
        unreported: [],
        frozen: [],
        autoHide: { status: "applied", yards: [] },
      },
    },
  });
});

const yard = {
  source: "pyp",
  locationCode: "tulsa",
  vehicleCount: 150,
  outcome: "fetched",
  lastCheckedHoursAgo: 3,
  lastChangedHoursAgo: 3,
  consecutiveUncheckedRuns: 0,
};

test("all-sources status is 200 degraded and lists a yard no run fetched in 36 hours", () => {
  expect(
    statusFor(
      allFresh,
      [],
      [],
      [
        yard,
        {
          ...yard,
          locationCode: "norbs",
          outcome: "blocked",
          lastCheckedHoursAgo: 50,
          consecutiveUncheckedRuns: 2,
        },
        {
          ...yard,
          source: "aero",
          locationCode: "shreveport",
          outcome: "unreported",
          lastCheckedHoursAgo: null,
        },
      ],
    ),
  ).toMatchObject({
    status: 200,
    body: {
      status: "degraded",
      stale: [],
      yards: {
        status: "ok",
        checked: 3,
        notChecked: [
          {
            source: "pyp",
            name: "LKQ Pick Your Part",
            code: "norbs",
            outcome: "blocked",
            lastCheckedAt: expect.any(String),
            consecutiveUncheckedRuns: 2,
          },
        ],
        unreported: [
          { source: "aero", code: "shreveport", lastCheckedAt: null },
        ],
        frozen: [],
      },
    },
  });
});

test("all-sources status lists a checked but frozen yard as information only", () => {
  expect(
    statusFor(
      allFresh,
      [],
      [],
      [
        { ...yard, lastChangedHoursAgo: 4 * 24 },
        {
          ...yard,
          locationCode: "small",
          vehicleCount: 99,
          lastChangedHoursAgo: 4 * 24,
        },
      ],
    ),
  ).toMatchObject({
    status: 200,
    body: {
      status: "healthy",
      yards: {
        notChecked: [],
        frozen: [{ source: "pyp", code: "tulsa", vehicleCount: 150 }],
      },
    },
  });
});

test("all-sources status ignores yards of a paused source", () => {
  expect(
    statusFor(allFresh, ["pyp"], [], [{ ...yard, lastCheckedHoursAgo: 50 }]),
  ).toMatchObject({
    body: { yards: { checked: 0, notChecked: [] } },
  });
});

test("all-sources status still checks sources when the yard read fails", () => {
  expect(statusFor(allFresh, [], [], "read fails")).toMatchObject({
    status: 200,
    body: {
      status: "healthy",
      yards: {
        status: "unavailable",
        error: expect.stringContaining("yard_check"),
        detail: "SQLITE_BUSY: yard_check",
      },
    },
  });
});

test("all-sources status is 200 degraded and lists a few stale sources", () => {
  expect(statusFor({ ...withoutAero, pyp: 40 }, [])).toMatchObject({
    status: 200,
    body: {
      status: "degraded",
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

test("all-sources status is 503 once a fifth of the checked sources are stale", () => {
  const outageAfterStale = Math.ceil(ACTIVE_INGESTION_SOURCES.length * 0.2);
  const staleSources = ACTIVE_INGESTION_SOURCES.slice(0, outageAfterStale);
  const published = Object.fromEntries(
    ACTIVE_INGESTION_SOURCES.map((source) => [
      source,
      staleSources.includes(source) ? 40 : 3,
    ]),
  );
  expect(statusFor(published, [])).toMatchObject({
    status: 503,
    body: { status: "stale", outageAfterStale },
  });
});

test("all-sources status ignores a paused source", () => {
  expect(statusFor(withoutAero, ["aero"])).toMatchObject({
    status: 200,
    body: { status: "healthy", paused: ["aero"], stale: [] },
  });
});

test("all-sources status ignores a source the owner paused from /admin", () => {
  expect(statusFor(withoutAero, [], ["aero"])).toMatchObject({
    status: 200,
    body: { status: "healthy", paused: ["aero"], stale: [] },
  });
});

test("all-sources status is 503 naming the database read when the pause list cannot be read", () => {
  expect(statusFor(allFresh, [], "read fails")).toEqual({
    status: 503,
    cacheControl: "no-store",
    body: {
      status: "unavailable",
      error: expect.stringContaining("source_control"),
      detail: "SQLITE_BUSY: database is locked",
    },
  });
});

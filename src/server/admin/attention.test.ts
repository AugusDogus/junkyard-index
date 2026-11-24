import { SourceControl } from "~/server/source-control/source-control";
import { describe, expect, test } from "bun:test";
import { Attention } from "./attention";
import type { SourceSummary } from "./source-overview";
import type { RunOutcome, SourceRun } from "./source-run";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-11-22T15:00:00Z");

const failedRun: SourceRun = {
  id: "source-run-1",
  runId: "run-1",
  source: "pyp",
  status: "error",
  acceptanceStatus: "rejected",
  runStatus: "success",
  stage: "released",
  startedAt: now,
  completedAt: now,
  inventoryPublishedAt: null,
  pagesProcessed: 0,
  vehiclesProcessed: 0,
  uniqueVehicles: 0,
  duplicateVehicles: 0,
  rejectedVehicles: 0,
};

function summary(overrides: Partial<SourceSummary>): SourceSummary {
  return {
    source: "pyp",
    name: "LKQ Pick Your Part",
    state: "failing",
    retired: false,
    control: SourceControl.initial("pyp"),
    flag: "on",
    pausedBy: null,
    latestRun: {
      run: failedRun,
      outcome: { kind: "rejected", reason: "error" },
    },
    consecutiveFailures: 2,
    lastAcceptedAt: null,
    stale: false,
    nextCrawlDay: null,
    publishedVehicles: null,
    vehicleChange: null,
    stuck: null,
    ...overrides,
  };
}

const quiet = {
  now,
  sources: [],
  latestErrors: new Map(),
  searchProblems: [],
  alertProblems: [],
  listedRunIds: new Set<string>(),
};

describe("Attention.collect", () => {
  test("lists a source that failed two or more runs in a row, with why", () => {
    expect(
      Attention.collect({
        ...quiet,
        sources: [summary({})],
        latestErrors: new Map([
          [
            "source-run-1",
            {
              errors: JSON.stringify(["Pyp timed out after 20000ms"]),
              validationErrors: null,
              runErrors: null,
            },
          ],
        ]),
      }),
    ).toEqual([
      {
        title: "LKQ Pick Your Part failed its last 2 runs",
        detail: "The yard's website was too slow to answer in time.",
        raw: "Pyp timed out after 20000ms",
        href: "/admin/sources/pyp",
      },
    ]);
  });

  test("lists a stale source after a single failure, once, with why", () => {
    expect(
      Attention.collect({
        ...quiet,
        sources: [summary({ consecutiveFailures: 1, stale: true })],
        latestErrors: new Map([
          [
            "source-run-1",
            {
              errors: JSON.stringify(["Pyp timed out after 20000ms"]),
              validationErrors: null,
              runErrors: JSON.stringify(["Pyp timed out after 20000ms"]),
            },
          ],
        ]),
      }),
    ).toEqual([
      {
        title:
          "LKQ Pick Your Part has not been updated for over 36 hours (its last run failed)",
        detail: "The yard's website was too slow to answer in time.",
        raw: "Pyp timed out after 20000ms",
        href: "/admin/sources/pyp",
      },
    ]);
  });

  test("lists a stale source with no recent runs", () => {
    expect(
      Attention.collect({
        ...quiet,
        sources: [
          summary({
            state: "stale",
            stale: true,
            consecutiveFailures: 0,
            latestRun: null,
          }),
        ],
      }),
    ).toEqual([
      {
        title: "LKQ Pick Your Part has not been updated for over 36 hours",
        detail:
          "No run of it has been accepted since, so its vehicles on the site may be out of date.",
        raw: null,
        href: "/admin/sources/pyp",
      },
    ]);
  });

  test("leaves out a single failure, and paused or retired sources", () => {
    expect(
      Attention.collect({
        ...quiet,
        sources: [
          summary({ consecutiveFailures: 1 }),
          summary({ state: "paused", flag: "off", pausedBy: "flag" }),
          summary({ state: "paused", pausedBy: "admin" }),
          summary({ state: "retired", retired: true }),
        ],
      }),
    ).toEqual([]);
  });

  test("lists a run with no progress for hours", () => {
    expect(
      Attention.collect({
        ...quiet,
        sources: [
          summary({
            state: "running",
            consecutiveFailures: 0,
            stuck: {
              runId: "run-9",
              stage: "reconcile_upsert",
              lastProgressAt: new Date(now.getTime() - 5.5 * HOUR),
            },
          }),
        ],
      }),
    ).toEqual([
      {
        title: "LKQ Pick Your Part's run has made no progress for 5 hours",
        detail:
          "It is stuck at the reconcile_upsert stage. Run run-9 still holds the source, so no new run of it can start.",
        raw: null,
        href: "/admin/sources/pyp",
      },
    ]);
  });

  test("leaves out a stalled run the run-hold items already list with a stop", () => {
    expect(
      Attention.collect({
        ...quiet,
        listedRunIds: new Set(["run-9"]),
        sources: [
          summary({
            state: "running",
            consecutiveFailures: 0,
            stuck: {
              runId: "run-9",
              stage: "reconcile_upsert",
              lastProgressAt: new Date(now.getTime() - 5.5 * HOUR),
            },
          }),
        ],
      }),
    ).toEqual([]);
  });

  test("lists search and alert problems with their raw text", () => {
    expect(
      Attention.collect({
        ...quiet,
        searchProblems: ["Search trails Turso by 300 minutes."],
        alertProblems: ["No alert check completed.", "Delivery waits."],
      }),
    ).toEqual([
      {
        title: "Search is behind or blocked",
        detail: "Newly found vehicles may be missing from search results.",
        raw: "Search trails Turso by 300 minutes.",
        href: "/admin/search",
      },
      {
        title: "Saved-search alerts are behind",
        detail:
          "Subscribers may not be getting their alert emails or messages.",
        raw: "No alert check completed.\nDelivery waits.",
        href: "/admin/search",
      },
    ]);
  });
});

describe("Attention.runsShowingErrors", () => {
  const latest = (
    id: string,
    outcome: RunOutcome,
  ): SourceSummary["latestRun"] => ({
    run: { ...failedRun, id },
    outcome,
  });
  const accepted: RunOutcome = { kind: "accepted", publishedAt: now };

  test("reads errors only for rejected latest runs and listed sources", () => {
    expect(
      Attention.runsShowingErrors([
        // Rejected once: the sources table shows why.
        summary({
          latestRun: latest("rejected", { kind: "rejected", reason: "error" }),
          consecutiveFailures: 1,
        }),
        // Out of date with an accepted latest run: the overview lists it.
        summary({
          source: "row52",
          latestRun: latest("stale", accepted),
          consecutiveFailures: 0,
          stale: true,
        }),
        // Fresh and accepted: no page shows its errors.
        summary({
          source: "pullapart",
          latestRun: latest("fresh", accepted),
          consecutiveFailures: 0,
        }),
        summary({
          source: "tearapart",
          latestRun: latest("running", { kind: "running" }),
          consecutiveFailures: 0,
        }),
        summary({ source: "upullitne", latestRun: null }),
      ]).map((run) => run.id),
    ).toEqual(["rejected", "stale"]);
  });

  test("skips the errors of out-of-date sources the overview leaves out", () => {
    expect(
      Attention.runsShowingErrors([
        summary({
          source: "row52",
          flag: "off",
          pausedBy: "flag",
          latestRun: latest("off", accepted),
          consecutiveFailures: 0,
          stale: true,
        }),
        summary({
          source: "upullitne",
          pausedBy: "admin",
          latestRun: latest("admin-paused", accepted),
          consecutiveFailures: 3,
          stale: true,
        }),
        summary({
          source: "pullapart",
          retired: true,
          latestRun: latest("retired", accepted),
          consecutiveFailures: 5,
          stale: true,
        }),
      ]),
    ).toEqual([]);
  });
});

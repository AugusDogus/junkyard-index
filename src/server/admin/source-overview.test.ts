import { describe, expect, test } from "bun:test";
import type { SourceRun } from "./source-run";
import {
  SourceOverview,
  STUCK_AFTER_MS,
  type SourceOverviewInput,
  type SourceSummary,
} from "./source-overview";

const HOUR = 60 * 60 * 1000;
// Ingestion days start at 07:00 UTC.
const now = new Date("2026-11-22T15:00:00Z");
const today = new Date("2026-11-22T08:00:00Z");
const yesterday = new Date("2026-11-21T08:00:00Z");
const twoDaysAgo = new Date("2026-11-20T08:00:00Z");

let next = 0;
function run(
  source: string,
  startedAt: Date,
  ending:
    | { kind: "accepted"; vehicles: number }
    | { kind: "error" }
    | { kind: "rejected" }
    | { kind: "running" },
): SourceRun {
  next += 1;
  const finished = ending.kind !== "running";
  return {
    id: `source-run-${next}`,
    runId: `run-${next}`,
    source,
    status:
      ending.kind === "error"
        ? "error"
        : ending.kind === "running"
          ? "running"
          : "success",
    acceptanceStatus:
      ending.kind === "accepted"
        ? "accepted"
        : ending.kind === "rejected"
          ? "rejected"
          : "pending",
    runStatus: finished ? "success" : "running",
    stage: finished ? "released" : "sources",
    startedAt,
    completedAt: finished ? new Date(startedAt.getTime() + HOUR) : null,
    inventoryPublishedAt:
      ending.kind === "accepted"
        ? new Date(startedAt.getTime() + 2 * HOUR)
        : null,
    pagesProcessed: 1,
    vehiclesProcessed: ending.kind === "accepted" ? ending.vehicles : 0,
    uniqueVehicles: ending.kind === "accepted" ? ending.vehicles : 0,
    duplicateVehicles: 0,
    rejectedVehicles: 0,
  };
}

const input = (
  overrides: Partial<SourceOverviewInput> = {},
): SourceOverviewInput => ({
  now,
  runs: [],
  activeRuns: [],
  publishedCounts: new Map(),
  flags: { status: "read", enabled: new Set(["pyp", "row52", "meeks"]) },
  ...overrides,
});

function summaryFor(
  summaries: readonly SourceSummary[],
  source: string,
): SourceSummary {
  const summary = summaries.find((entry) => entry.source === source);
  if (summary === undefined) throw new Error(`No summary for ${source}`);
  return summary;
}

describe("SourceOverview.build", () => {
  test("lists every ingestion source once", () => {
    const summaries = SourceOverview.build(input());
    expect(new Set(summaries.map((entry) => entry.source)).size).toBe(
      summaries.length,
    );
    expect(summaries.map((entry) => entry.source)).toContain("pyp");
  });

  test("a source that published today is accepted today, with its count and change", () => {
    const summary = summaryFor(
      SourceOverview.build(
        input({
          runs: [
            run("pyp", yesterday, { kind: "accepted", vehicles: 900 }),
            run("pyp", today, { kind: "accepted", vehicles: 950 }),
          ],
          publishedCounts: new Map([["pyp", 948]]),
        }),
      ),
      "pyp",
    );
    expect(summary).toMatchObject({
      state: "accepted_today",
      consecutiveFailures: 0,
      publishedVehicles: 948,
      vehicleChange: 50,
      lastAcceptedAt: new Date(today.getTime() + 2 * HOUR),
    });
    expect(summary.latestRun?.outcome.kind).toBe("accepted");
  });

  test("counts failed runs since the last accepted one", () => {
    const summary = summaryFor(
      SourceOverview.build(
        input({
          runs: [
            run("pyp", twoDaysAgo, { kind: "accepted", vehicles: 900 }),
            run("pyp", yesterday, { kind: "error" }),
            run("pyp", today, { kind: "rejected" }),
          ],
        }),
      ),
      "pyp",
    );
    expect(summary).toMatchObject({
      state: "failing",
      consecutiveFailures: 2,
      vehicleChange: null,
    });
  });

  test("a source accepted before today with no failure since waits for today", () => {
    expect(
      summaryFor(
        SourceOverview.build(
          input({
            runs: [run("pyp", yesterday, { kind: "accepted", vehicles: 1 })],
          }),
        ),
        "pyp",
      ).state,
    ).toBe("waiting");
  });

  test("a running run makes the source running, and does not end a failure streak", () => {
    const summary = summaryFor(
      SourceOverview.build(
        input({
          runs: [
            run("pyp", yesterday, { kind: "error" }),
            run("pyp", today, { kind: "running" }),
          ],
        }),
      ),
      "pyp",
    );
    expect(summary).toMatchObject({ state: "running", consecutiveFailures: 1 });
  });

  test("an active run without progress for hours is stuck", () => {
    const lastProgressAt = new Date(now.getTime() - STUCK_AFTER_MS - 1);
    const summary = summaryFor(
      SourceOverview.build(
        input({
          activeRuns: [
            {
              runId: "run-x",
              source: "pyp",
              stage: "reconcile_upsert",
              startedAt: today,
              lastProgressAt,
            },
          ],
        }),
      ),
      "pyp",
    );
    expect(summary.state).toBe("running");
    expect(summary.stuck).toEqual({
      runId: "run-x",
      stage: "reconcile_upsert",
      lastProgressAt,
    });
  });

  test("an unpaused source with no runs in the window is stale", () => {
    expect(summaryFor(SourceOverview.build(input()), "pyp")).toMatchObject({
      state: "stale",
      stale: true,
      consecutiveFailures: 0,
      lastAcceptedAt: null,
    });
  });

  test("a source last accepted over 36 hours ago is stale, though its runs did not fail", () => {
    expect(
      summaryFor(
        SourceOverview.build(
          input({
            runs: [run("pyp", twoDaysAgo, { kind: "accepted", vehicles: 1 })],
          }),
        ),
        "pyp",
      ),
    ).toMatchObject({ state: "stale", stale: true });
  });

  test("a failing source past the freshness limit stays failing and is marked stale", () => {
    expect(
      summaryFor(
        SourceOverview.build(
          input({
            runs: [
              run("pyp", twoDaysAgo, { kind: "accepted", vehicles: 1 }),
              run("pyp", today, { kind: "rejected" }),
            ],
          }),
        ),
        "pyp",
      ),
    ).toMatchObject({ state: "failing", stale: true, consecutiveFailures: 1 });
  });

  test("paused and retired sources are never stale", () => {
    const summaries = SourceOverview.build(
      input({ flags: { status: "read", enabled: new Set() } }),
    );
    expect(summaryFor(summaries, "pyp")).toMatchObject({
      state: "paused",
      stale: false,
    });
    expect(summaryFor(summaries, "brandywine")).toMatchObject({
      state: "retired",
      stale: false,
    });
  });

  test("a source whose flag serves false is paused", () => {
    expect(
      summaryFor(
        SourceOverview.build(
          input({ flags: { status: "read", enabled: new Set(["row52"]) } }),
        ),
        "pyp",
      ),
    ).toMatchObject({ state: "paused", flag: "off" });
  });

  test("unreadable flags pause nothing and say so", () => {
    expect(
      summaryFor(
        SourceOverview.build(
          input({
            runs: [run("pyp", yesterday, { kind: "accepted", vehicles: 1 })],
            flags: { status: "unavailable", message: "boom" },
          }),
        ),
        "pyp",
      ),
    ).toMatchObject({ state: "waiting", flag: "unknown" });
  });

  test("retired and hidden sources are marked", () => {
    const summaries = SourceOverview.build(input());
    expect(summaryFor(summaries, "brandywine")).toMatchObject({
      state: "retired",
      retired: true,
    });
    expect(summaryFor(summaries, "meeks").hiddenReason).toContain(
      "meeksrecycling.com",
    );
    expect(summaryFor(summaries, "pyp").hiddenReason).toBeNull();
  });

  test("orders problems first", () => {
    const summaries = SourceOverview.build(
      input({
        runs: [
          run("pyp", today, { kind: "accepted", vehicles: 1 }),
          run("row52", yesterday, { kind: "error" }),
          run("row52", today, { kind: "error" }),
          run("meeks", today, { kind: "error" }),
        ],
      }),
    );
    const order = summaries.map((entry) => entry.source);
    expect(order.slice(0, 2)).toEqual(["row52", "meeks"]);
    expect(order.indexOf("pyp")).toBeLessThan(order.indexOf("brandywine"));
    expect(order.at(-1)).toBe("upullitne");
  });

  test("orders a stuck run before every failing source", () => {
    const summaries = SourceOverview.build(
      input({
        runs: [run("row52", today, { kind: "error" })],
        activeRuns: [
          {
            runId: "run-x",
            source: "pyp",
            stage: "reconcile_upsert",
            startedAt: twoDaysAgo,
            lastProgressAt: new Date(now.getTime() - STUCK_AFTER_MS - 1),
          },
        ],
      }),
    );
    expect(summaries.map((entry) => entry.source).slice(0, 2)).toEqual([
      "pyp",
      "row52",
    ]);
  });
});

describe("SourceOverview.counts", () => {
  test("counts sources by state, and hidden ones apart", () => {
    const counts = SourceOverview.counts(
      SourceOverview.build(
        input({
          runs: [
            run("pyp", today, { kind: "accepted", vehicles: 1 }),
            run("row52", today, { kind: "error" }),
          ],
        }),
      ),
    );
    expect(counts.byState.accepted_today).toBe(1);
    expect(counts.byState.failing).toBe(1);
    expect(counts.byState.retired).toBe(2);
    expect(counts.hidden).toBe(1);
  });
});

describe("SourceOverview.lastRunStartedAt", () => {
  test("is the newest run start", () => {
    expect(
      SourceOverview.lastRunStartedAt([
        run("pyp", yesterday, { kind: "error" }),
        run("row52", today, { kind: "error" }),
      ]),
    ).toEqual(today);
    expect(SourceOverview.lastRunStartedAt([])).toBeNull();
  });
});

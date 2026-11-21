import { describe, expect, test } from "bun:test";
import {
  runSearchProjector,
  searchProjectorTickNotifies,
  searchProjectorTickOutcome,
  summarizeSearchProjectorTick,
  type SearchProjectorTick,
} from "./search-projector-consumer";

function projected(changes: number, caughtUp: boolean): SearchProjectorTick {
  return {
    status: "projected",
    from: 0,
    projectedThrough: changes,
    horizon: caughtUp ? changes : changes + 1,
    changes,
    upserted: changes,
    deleted: 0,
    deadLettered: 0,
    caughtUp,
  };
}

describe("search projector consumer", () => {
  test("steps until it catches up and totals the changes", async () => {
    const ticks = [
      projected(5, false),
      projected(3, false),
      projected(2, true),
    ];
    const run = await runSearchProjector({
      step: async () =>
        ticks.shift() ?? { status: "current", projectedThrough: 0, horizon: 0 },
      maxSteps: 10,
      progress: async () => {},
    });
    expect(run).toEqual({ last: projected(2, true), steps: 3, changes: 10 });
  });

  test("reports progress every ten steps of a long run", async () => {
    const reported: number[] = [];
    const run = await runSearchProjector({
      step: async () => projected(1, false),
      maxSteps: 25,
      progress: async (progress) => {
        reported.push(progress.steps);
      },
    });
    expect(run.steps).toBe(25);
    expect(reported).toEqual([10, 20]);
  });

  test("keeps stepping through a rebuild until it goes live and replays", async () => {
    const ticks: SearchProjectorTick[] = [
      { status: "rebuild_requested", generationId: "gen", reason: "bootstrap" },
      {
        status: "rebuild_prepared",
        generationId: "gen",
        snapshotChangeId: 9,
        sweptIndices: 1,
      },
      {
        status: "rebuild_loading",
        generationId: "gen",
        recordsLoaded: 5,
        deadLettered: 0,
        loaded: true,
      },
      { status: "rebuild_live", generationId: "gen", snapshotChangeId: 9 },
      projected(2, true),
    ];
    const run = await runSearchProjector({
      step: async () =>
        ticks.shift() ?? { status: "current", projectedThrough: 0, horizon: 0 },
      maxSteps: 10,
      progress: async () => {},
    });
    expect(run).toMatchObject({ steps: 5, changes: 2 });
  });

  test("ends a run at its step limit while still behind", async () => {
    const run = await runSearchProjector({
      step: async () => projected(1, false),
      maxSteps: 4,
      progress: async () => {},
    });
    expect(run.steps).toBe(4);
    expect(run.changes).toBe(4);
  });

  test("stops at a failure and counts the changes written before it", async () => {
    const run = await runSearchProjector({
      step: async () => ({
        status: "failed",
        tag: "SearchBackendBlocked",
        message: "blocked",
        failureCount: 1,
        retryAt: "2026-11-20T12:15:00.000Z",
        opened: true,
        changes: 7,
      }),
      maxSteps: 10,
      progress: async () => {},
    });
    expect(run).toMatchObject({ steps: 1, changes: 7 });
  });

  test("a tick fails its heartbeat whenever search is left behind", () => {
    const failed: SearchProjectorTick[] = [
      { status: "mode_unavailable" },
      { status: "refused", message: "refused" },
      { status: "inline_writer_active", runIds: ["run"] },
      { status: "environment_mismatch", generationEnvironment: "preview" },
      {
        status: "record_cap",
        generationId: "gen",
        entries: 600_000,
        vehicles: 430_000,
        cap: 1_000_000,
        retryAt: "2026-11-20T12:15:00.000Z",
      },
      { status: "move_unconfirmed", generationId: "gen", message: "check" },
      {
        status: "drift_checked",
        day: "2026-11-20",
        entries: 1,
        vehicles: 500,
        drifted: true,
        consecutiveDrifts: 2,
        rebuildRequested: null,
      },
      {
        status: "circuit_open",
        tag: "QuotaExceeded",
        failureCount: 2,
        retryAt: "2026-11-20T12:30:00.000Z",
      },
    ];
    for (const tick of failed) {
      expect(searchProjectorTickOutcome(tick)).toBe("failed");
    }
    const succeeded: SearchProjectorTick[] = [
      { status: "inline_mode" },
      { status: "paused" },
      { status: "current", projectedThrough: 4, horizon: 4 },
      projected(4, true),
      { status: "stopped" },
      {
        status: "rebuild_loading",
        generationId: "gen",
        recordsLoaded: 10,
        deadLettered: 0,
        loaded: false,
      },
      {
        status: "drift_checked",
        day: "2026-11-20",
        entries: 1,
        vehicles: 500,
        drifted: true,
        consecutiveDrifts: 1,
        rebuildRequested: "gen",
      },
    ];
    for (const tick of succeeded) {
      expect(searchProjectorTickOutcome(tick)).toBe("succeeded");
    }
  });

  test("raises a Sentry issue once per circuit opening", () => {
    const failed = (opened: boolean): SearchProjectorTick => ({
      status: "failed",
      tag: "QuotaExceeded",
      message: "quota",
      failureCount: opened ? 1 : 2,
      retryAt: "2026-11-20T12:15:00.000Z",
      opened,
      changes: 0,
    });
    expect(searchProjectorTickNotifies(failed(true))).toBe(true);
    expect(searchProjectorTickNotifies(failed(false))).toBe(false);
    expect(
      searchProjectorTickNotifies({
        status: "circuit_open",
        tag: "QuotaExceeded",
        failureCount: 2,
        retryAt: "2026-11-20T12:45:00.000Z",
      }),
    ).toBe(false);
    expect(
      searchProjectorTickNotifies({
        status: "inline_writer_active",
        runIds: ["a"],
      }),
    ).toBe(true);
  });

  test("summaries are flat scalars for Sentry", () => {
    expect(
      summarizeSearchProjectorTick({
        status: "inline_writer_active",
        runIds: ["a", "b"],
      }),
    ).toEqual({ status: "inline_writer_active", runIds: "a,b" });
  });
});

import { describe, expect, test } from "bun:test";
import {
  claimCommitTurn,
  runIngestionPass,
  type IngestionPassOperations,
  type IngestionPassPlan,
  type IngestionRunReport,
} from "./ingestion-pass-orchestrator";

function passOperations(
  plans: IngestionPassPlan[],
  reports: Array<IngestionRunReport | "timeout">,
) {
  const events: string[] = [];
  const operations: IngestionPassOperations = {
    plan: async () => {
      const next = plans.shift();
      if (!next) throw new Error("Planned more times than expected");
      events.push(`plan:${next.status}`);
      return next;
    },
    startRuns: async (runIds) => {
      events.push(`start:${runIds.join(",")}`);
    },
    nextReport: async (deadline) => {
      const report = reports.shift();
      if (!report) throw new Error("Waited for more reports than expected");
      if (deadline !== null) events.push(`deadline:${deadline}`);
      events.push(report === "timeout" ? "timeout" : `report:${report.runId}`);
      return report;
    },
    sleepUntil: async (time) => {
      events.push(`sleep:${time}`);
    },
    pauseAfterFailure: async () => {
      events.push("pause");
    },
    deliverNotifications: async () => {
      events.push("deliver");
    },
  };
  return { operations, events };
}

describe("runIngestionPass", () => {
  test("runs every due source, retries a failed one, then delivers once", async () => {
    const { operations, events } = passOperations(
      [
        { status: "active", runIds: ["row52", "pyp"], retryAt: null },
        { status: "waiting", retryAt: 2_000 },
        { status: "active", runIds: ["pyp-retry"], retryAt: null },
        { status: "complete" },
      ],
      [
        { runId: "row52", failed: false },
        { runId: "pyp", failed: false },
        { runId: "pyp-retry", failed: false },
      ],
    );

    expect(await runIngestionPass(operations)).toBe("completed");

    expect(events).toEqual([
      "plan:active",
      "start:row52,pyp",
      "report:row52",
      "report:pyp",
      "plan:waiting",
      "sleep:2000",
      "plan:active",
      "start:pyp-retry",
      "report:pyp-retry",
      "plan:complete",
      "deliver",
    ]);
  });

  test("re-plans after a failed run or a watchdog timeout to resume runs", async () => {
    const { operations, events } = passOperations(
      [
        { status: "active", runIds: ["row52", "pyp"], retryAt: null },
        { status: "active", runIds: ["row52", "pyp"], retryAt: null },
        { status: "active", runIds: ["row52", "pyp"], retryAt: null },
        { status: "complete" },
      ],
      [
        { runId: "pyp", failed: true },
        "timeout",
        { runId: "row52", failed: false },
        { runId: "pyp", failed: false },
      ],
    );

    expect(await runIngestionPass(operations)).toBe("completed");

    expect(events).toEqual([
      "plan:active",
      "start:row52,pyp",
      "report:pyp",
      "pause",
      "plan:active",
      "start:row52,pyp",
      "timeout",
      "plan:active",
      "start:row52,pyp",
      "report:row52",
      "report:pyp",
      "plan:complete",
      "deliver",
    ]);
  });
});

describe("runIngestionPass with a retry due while runs are active", () => {
  test("re-plans at the retry time instead of waiting for every report", async () => {
    // pyp was released at validation and retries at 5000, while row52 waits
    // for the commit and keeps reporting nothing.
    const { operations, events } = passOperations(
      [
        { status: "active", runIds: ["row52"], retryAt: 5_000 },
        { status: "active", runIds: ["row52", "pyp-retry"], retryAt: null },
        { status: "complete" },
      ],
      [
        "timeout",
        { runId: "row52", failed: false },
        { runId: "pyp-retry", failed: false },
      ],
    );

    expect(await runIngestionPass(operations)).toBe("completed");

    expect(events).toEqual([
      "plan:active",
      "start:row52",
      "deadline:5000",
      "timeout",
      "plan:active",
      "start:row52,pyp-retry",
      "report:row52",
      "report:pyp-retry",
      "plan:complete",
      "deliver",
    ]);
  });
});

describe("runIngestionPass on a finished day", () => {
  test("reports an already-complete day so hourly passes skip end-of-day work", async () => {
    const { operations, events } = passOperations([{ status: "complete" }], []);

    expect(await runIngestionPass(operations)).toBe("already-complete");

    expect(events).toEqual(["plan:complete", "deliver"]);
  });
});

describe("runIngestionPass after its day", () => {
  test("stops without delivering once its ingestion day has ended", async () => {
    const { operations, events } = passOperations(
      [{ status: "waiting", retryAt: 2_000 }, { status: "expired" }],
      [],
    );

    expect(await runIngestionPass(operations)).toBe("expired");

    expect(events).toEqual(["plan:waiting", "sleep:2000", "plan:expired"]);
  });
});

describe("claimCommitTurn", () => {
  test("waits for turns while the commit is busy", async () => {
    const claims: Array<"claimed" | "busy" | "stopped"> = [
      "busy",
      "busy",
      "claimed",
    ];
    let waits = 0;
    expect(
      await claimCommitTurn({
        claim: async () => claims.shift() ?? "stopped",
        waitForTurn: async () => {
          waits += 1;
        },
      }),
    ).toBe("claimed");
    expect(waits).toBe(2);
  });
});

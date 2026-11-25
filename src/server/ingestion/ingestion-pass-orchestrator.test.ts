import { describe, expect, test } from "bun:test";
import { HostClaims } from "./host-claims";
import {
  claimCommitTurn,
  runIngestionPass,
  type IngestionPassOperations,
  type IngestionPassPlan,
  type IngestionRunReport,
} from "./ingestion-pass-orchestrator";

/** Runs that need no shared host. */
const active = (
  runIds: string[],
  retryAt: number | null,
): IngestionPassPlan => ({
  status: "active",
  runs: runIds.map((runId) => ({
    runId,
    claims: HostClaims.none,
    started: false,
  })),
  retryAt,
});

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
      events.push(
        report === "timeout"
          ? "timeout"
          : "replan" in report
            ? "replan"
            : "fetched" in report
              ? `fetched:${report.runId}`
              : `report:${report.runId}`,
      );
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
        active(["row52", "pyp"], null),
        { status: "waiting", retryAt: 2_000 },
        active(["pyp-retry"], null),
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
        active(["row52", "pyp"], null),
        active(["row52", "pyp"], null),
        active(["row52", "pyp"], null),
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
        active(["row52"], 5_000),
        active(["row52", "pyp-retry"], null),
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

describe("runIngestionPass with shared hosts", () => {
  const lane = (name: string, places = 2): HostClaims => ({
    lanes: [name],
    places: [{ group: "urg", capacity: places }],
  });
  const plan = (
    runs: Array<[string, HostClaims, boolean]>,
  ): IngestionPassPlan => ({
    status: "active",
    runs: runs.map(([runId, claims, started]) => ({ runId, claims, started })),
    retryAt: null,
  });

  test("starts one run per lane and the next once it has fetched", async () => {
    const { operations, events } = passOperations(
      [
        plan([
          ["aviation", lane("aws"), false],
          ["central", lane("aws"), false],
          ["row52", HostClaims.none, false],
        ]),
        { status: "complete" },
      ],
      [
        { runId: "aviation", fetched: true },
        { runId: "row52", failed: false },
        { runId: "aviation", failed: false },
        { runId: "central", fetched: true },
        { runId: "central", failed: false },
      ],
    );

    expect(await runIngestionPass(operations)).toBe("completed");

    expect(events).toEqual([
      "plan:active",
      "start:aviation,row52",
      "fetched:aviation",
      "start:central",
      "report:row52",
      "report:aviation",
      "fetched:central",
      "report:central",
      "plan:complete",
      "deliver",
    ]);
  });

  test("admits no more runs than a group's places", async () => {
    const { operations, events } = passOperations(
      [
        plan([
          ["a", lane("a", 1), false],
          ["b", lane("b", 1), false],
        ]),
        { status: "complete" },
      ],
      [
        { runId: "a", failed: false },
        { runId: "b", failed: false },
      ],
    );

    await runIngestionPass(operations);

    expect(events.slice(0, 4)).toEqual([
      "plan:active",
      "start:a",
      "report:a",
      "start:b",
    ]);
  });

  test("keeps the hosts of a run another pass started until it reports", async () => {
    // After a pass restart, central's workflow may still be fetching.
    const { operations, events } = passOperations(
      [
        plan([
          ["central", lane("aws"), true],
          ["aviation", lane("aws"), false],
        ]),
        { status: "complete" },
      ],
      [
        { runId: "central", failed: false },
        { runId: "aviation", failed: false },
      ],
    );

    await runIngestionPass(operations);

    expect(events.slice(0, 4)).toEqual([
      "plan:active",
      "start:central",
      "report:central",
      "start:aviation",
    ]);
  });

  test("keeps the hosts of a run it started across a re-plan", async () => {
    // The plan does not see that this pass already started aviation.
    const { operations, events } = passOperations(
      [
        plan([
          ["aviation", lane("aws"), false],
          ["central", lane("aws"), false],
        ]),
        plan([
          ["aviation", lane("aws"), false],
          ["central", lane("aws"), false],
        ]),
        { status: "complete" },
      ],
      [
        "timeout",
        { runId: "aviation", fetched: true },
        { runId: "aviation", failed: false },
        { runId: "central", failed: false },
      ],
    );

    await runIngestionPass(operations);

    expect(events).toEqual([
      "plan:active",
      "start:aviation",
      "timeout",
      "plan:active",
      "start:aviation",
      "fetched:aviation",
      "start:central",
      "report:aviation",
      "report:central",
      "plan:complete",
      "deliver",
    ]);
  });

  test("starts runs that claim fewer lanes first", async () => {
    const urgiis: HostClaims = {
      lanes: ["eagle", "66.42.115.19"],
      places: [{ group: "urg", capacity: 2 }],
    };
    const { operations, events } = passOperations(
      [
        plan([
          ["urgiis", urgiis, false],
          ["pratt", lane("66.42.115.19"), false],
        ]),
        { status: "complete" },
      ],
      [
        { runId: "pratt", failed: false },
        { runId: "urgiis", failed: false },
      ],
    );

    await runIngestionPass(operations);

    expect(events.slice(0, 4)).toEqual([
      "plan:active",
      "start:pratt",
      "report:pratt",
      "start:urgiis",
    ]);
  });
});

describe("runIngestionPass with runs added or started elsewhere", () => {
  const aws: HostClaims = {
    lanes: ["aws"],
    places: [{ group: "urg", capacity: 2 }],
  };
  const plan = (runs: Array<[string, boolean]>): IngestionPassPlan => ({
    status: "active",
    runs: runs.map(([runId, started]) => ({ runId, claims: aws, started })),
    retryAt: null,
  });

  test("re-plans when asked, to admit a manual run", async () => {
    const { operations, events } = passOperations(
      [
        plan([["aviation", false]]),
        plan([
          ["aviation", false],
          ["central", false],
        ]),
        { status: "complete" },
      ],
      [
        { replan: true },
        { runId: "aviation", fetched: true },
        { runId: "aviation", failed: false },
        { runId: "central", failed: false },
      ],
    );

    await runIngestionPass(operations);

    expect(events.slice(0, 7)).toEqual([
      "plan:active",
      "start:aviation",
      "replan",
      "plan:active",
      "start:aviation",
      "fetched:aviation",
      "start:central",
    ]);
  });

  test("never admits a waiting run that reports, since something else started it", async () => {
    const { operations, events } = passOperations(
      [
        plan([
          ["aviation", false],
          ["central", false],
        ]),
        { status: "complete" },
      ],
      [
        { runId: "central", fetched: true },
        { runId: "aviation", fetched: true },
        { runId: "central", failed: false },
        { runId: "aviation", failed: false },
      ],
    );

    await runIngestionPass(operations);

    expect(events.filter((event) => event.startsWith("start:"))).toEqual([
      "start:aviation",
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

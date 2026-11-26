import { describe, expect, test } from "bun:test";
import { HostClaims } from "./host-claims";
import {
  FAILED_RUN_RESUME_DELAY_MS,
  PASS_STEP_RETRY_DELAY_MS,
  claimCommitTurn,
  runIngestionPass,
  type IngestionPassOperations,
  type IngestionPassPlan,
  type IngestionRunReport,
  type PassWatchdog,
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
  held: [],
  retryAt,
});

function passOperations(
  plans: Array<IngestionPassPlan | Error>,
  reports: Array<IngestionRunReport | "timeout">,
  options: { failStarts?: number } = {},
) {
  const events: string[] = [];
  const watchdogs: PassWatchdog[] = [];
  const startedWith: Array<[string, readonly string[]]> = [];
  let failStarts = options.failStarts ?? 0;
  const operations: IngestionPassOperations = {
    plan: async () => {
      const next = plans.shift();
      if (!next) throw new Error("Planned more times than expected");
      if (next instanceof Error) {
        events.push("plan:error");
        throw next;
      }
      events.push(`plan:${next.status}`);
      return next;
    },
    startRuns: async (runs) => {
      const runIds = runs.map((run) => run.runId);
      if (failStarts > 0) {
        failStarts--;
        events.push(`start-error:${runIds.join(",")}`);
        throw new Error("Workflow API unavailable");
      }
      events.push(`start:${runIds.join(",")}`);
      for (const run of runs) startedWith.push([run.runId, run.claims.lanes]);
    },
    nextReport: async (deadline, watchdog) => {
      const report = reports.shift();
      if (!report) throw new Error("Waited for more reports than expected");
      watchdogs.push(watchdog);
      if (deadline !== null) events.push(`deadline:${deadline}`);
      events.push(
        report === "timeout"
          ? "timeout"
          : "replan" in report
            ? "replan"
            : "fetched" in report
              ? `fetched:${report.runId}`
              : "yielded" in report
                ? `yielded:${report.runId}`
                : `report:${report.runId}`,
      );
      return report;
    },
    now: () => 0,
    deliverNotifications: async () => {
      events.push("deliver");
    },
  };
  return { operations, events, watchdogs, startedWith };
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
        "timeout",
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
      "deadline:2000",
      "timeout",
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
      // The failed run resumes at the next plan, after a pause.
      `deadline:${FAILED_RUN_RESUME_DELAY_MS}`,
      "timeout",
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
    held: [],
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
    held: [],
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

describe("runIngestionPass while it sleeps", () => {
  test("re-plans at once when asked while waiting for a retry", async () => {
    // A manual run of a shared-host source, two hours before the next retry.
    const { operations, events, watchdogs } = passOperations(
      [
        { status: "waiting", retryAt: 7_200_000 },
        active(["manual"], null),
        { status: "complete" },
      ],
      [{ replan: true }, { runId: "manual", failed: false }],
    );

    await runIngestionPass(operations);

    expect(events.slice(0, 5)).toEqual([
      "plan:waiting",
      "deadline:7200000",
      "replan",
      "plan:active",
      "start:manual",
    ]);
    // Waiting for a retry re-plans only when it is due or asked.
    expect(watchdogs[0]).toBe("none");
  });

  test("re-plans at once when asked while pausing after a failure", async () => {
    const { operations, events } = passOperations(
      [active(["pyp", "row52"], null), active(["row52", "manual"], null)],
      [{ runId: "pyp", failed: true }, { replan: true }],
    );

    await expect(runIngestionPass(operations)).rejects.toThrow(
      "Waited for more reports",
    );

    expect(events).toEqual([
      "plan:active",
      "start:pyp,row52",
      "report:pyp",
      `deadline:${FAILED_RUN_RESUME_DELAY_MS}`,
      "replan",
      "plan:active",
      "start:row52,manual",
    ]);
  });

  test("keeps starting runs on freed hosts while it pauses after a failure", async () => {
    const aws: HostClaims = {
      lanes: ["aws"],
      places: [{ group: "urg", capacity: 2 }],
    };
    const { operations, events } = passOperations(
      [
        {
          status: "active",
          runs: [
            { runId: "aviation", claims: aws, started: false },
            { runId: "central", claims: aws, started: false },
            { runId: "pyp", claims: HostClaims.none, started: false },
          ],
          held: [],
          retryAt: null,
        },
        { status: "complete" },
      ],
      [
        { runId: "pyp", failed: true },
        { runId: "aviation", fetched: true },
        "timeout",
      ],
    );

    await runIngestionPass(operations);

    expect(events.slice(0, 7)).toEqual([
      "plan:active",
      "start:aviation,pyp",
      "report:pyp",
      `deadline:${FAILED_RUN_RESUME_DELAY_MS}`,
      "fetched:aviation",
      "start:central",
      `deadline:${FAILED_RUN_RESUME_DELAY_MS}`,
    ]);
  });
});

describe("runIngestionPass when a step fails", () => {
  test("plans again after a pause instead of failing the pass", async () => {
    const { operations, events } = passOperations(
      [
        new Error("Turso unavailable"),
        active(["pyp"], null),
        { status: "complete" },
      ],
      ["timeout", { runId: "pyp", failed: false }],
    );

    expect(await runIngestionPass(operations)).toBe("completed");

    expect(events).toEqual([
      "plan:error",
      `deadline:${PASS_STEP_RETRY_DELAY_MS}`,
      "timeout",
      "plan:active",
      "start:pyp",
      "report:pyp",
      "plan:complete",
      "deliver",
    ]);
  });

  test("starts the runs again after a pause when starting them fails", async () => {
    const urg = (lane: string): HostClaims => ({
      lanes: [lane],
      places: [{ group: "urg", capacity: 2 }],
    });
    const plan: IngestionPassPlan = {
      status: "active",
      runs: [
        { runId: "aviation", claims: urg("aws"), started: false },
        { runId: "central", claims: urg("aws"), started: false },
      ],
      held: [],
      retryAt: null,
    };
    const { operations, events } = passOperations(
      [plan, plan, { status: "complete" }],
      [
        "timeout",
        { runId: "aviation", fetched: true },
        { runId: "aviation", failed: false },
        { runId: "central", failed: false },
      ],
      { failStarts: 1 },
    );

    await runIngestionPass(operations);

    // The admitted run keeps its lane, so central still waits for it.
    expect(events.slice(0, 7)).toEqual([
      "plan:active",
      "start-error:aviation",
      `deadline:${PASS_STEP_RETRY_DELAY_MS}`,
      "timeout",
      "plan:active",
      "start:aviation",
      "fetched:aviation",
    ]);
  });
});

describe("runIngestionPass with runs that change lanes", () => {
  const urg = (...lanes: string[]): HostClaims => ({
    lanes,
    places: [{ group: "urg", capacity: 3 }],
  });

  test("starts a run that handed its hosts back once its next lanes are free", async () => {
    // URG IIS finished a tenant and needs Lambert's lane, which Pratt holds.
    const { operations, events } = passOperations(
      [
        {
          status: "active",
          runs: [
            { runId: "urgiis", claims: urg("eagle"), started: false },
            { runId: "pratt", claims: urg("66.42.115.19"), started: false },
          ],
          held: [],
          retryAt: null,
        },
        { status: "complete" },
      ],
      [
        {
          runId: "urgiis",
          yielded: urg("66.42.115.19"),
          admitted: urg("eagle"),
        },
        { runId: "pratt", fetched: true },
        { runId: "urgiis", fetched: true },
        { runId: "pratt", failed: false },
        { runId: "urgiis", failed: false },
      ],
    );

    await runIngestionPass(operations);

    expect(events.slice(0, 5)).toEqual([
      "plan:active",
      "start:urgiis,pratt",
      "yielded:urgiis",
      "fetched:pratt",
      "start:urgiis",
    ]);
  });

  test("plans a run whose hand-back report was lost as waiting for its new lanes", async () => {
    const { operations, events } = passOperations(
      [
        {
          status: "active",
          runs: [
            { runId: "urgiis", claims: urg("eagle"), started: false },
            { runId: "pratt", claims: urg("66.42.115.19"), started: false },
          ],
          held: [],
          retryAt: null,
        },
        {
          status: "active",
          runs: [
            // Detached, so not started, and needing Lambert's lane now.
            { runId: "urgiis", claims: urg("66.42.115.19"), started: false },
            { runId: "pratt", claims: urg("66.42.115.19"), started: true },
          ],
          held: [],
          retryAt: null,
        },
        { status: "complete" },
      ],
      [
        "timeout",
        { runId: "pratt", fetched: true },
        { runId: "urgiis", fetched: true },
        { runId: "pratt", failed: false },
        { runId: "urgiis", failed: false },
      ],
    );

    await runIngestionPass(operations);

    expect(events.slice(0, 7)).toEqual([
      "plan:active",
      "start:urgiis,pratt",
      "timeout",
      "plan:active",
      "start:pratt",
      "fetched:pratt",
      "start:urgiis",
    ]);
  });

  test("keeps the lanes it admitted a run with, not every lane it might reach", async () => {
    const { operations, events } = passOperations(
      [
        {
          status: "active",
          runs: [{ runId: "urgiis", claims: urg("eagle"), started: false }],
          held: [],
          retryAt: null,
        },
        {
          status: "active",
          runs: [
            // Attached: the plan cannot tell it hands lanes back.
            {
              runId: "urgiis",
              claims: urg("eagle", "66.42.115.19"),
              started: true,
            },
            { runId: "pratt", claims: urg("66.42.115.19"), started: false },
          ],
          held: [],
          retryAt: null,
        },
      ],
      ["timeout"],
    );

    await expect(runIngestionPass(operations)).rejects.toThrow(
      "Waited for more reports",
    );

    expect(events).toEqual([
      "plan:active",
      "start:urgiis",
      "timeout",
      "plan:active",
      "start:urgiis,pratt",
    ]);
  });

  test("holds every lane an attached run it did not admit might reach", async () => {
    const { operations, events } = passOperations(
      [
        {
          status: "active",
          runs: [
            {
              runId: "urgiis",
              claims: urg("eagle", "66.42.115.19"),
              started: true,
            },
            { runId: "pratt", claims: urg("66.42.115.19"), started: false },
          ],
          held: [],
          retryAt: null,
        },
      ],
      [],
    );

    await expect(runIngestionPass(operations)).rejects.toThrow(
      "Waited for more reports",
    );

    expect(events).toEqual(["plan:active", "start:urgiis"]);
  });
});

describe("runIngestionPass with runs it must not let overlap", () => {
  const urg = (...lanes: string[]): HostClaims => ({
    lanes,
    places: [{ group: "urg", capacity: 3 }],
  });

  test("keeps a failed run's lanes until the plan that resumes it", async () => {
    const { operations, events } = passOperations(
      [
        {
          status: "active",
          runs: [
            { runId: "pratt", claims: urg("66.42.115.19"), started: false },
            { runId: "urgiis", claims: urg("66.42.115.19"), started: false },
          ],
          held: [],
          retryAt: null,
        },
        {
          status: "active",
          runs: [
            // Its workflow failed while fetching; this plan resumes it.
            { runId: "pratt", claims: urg("66.42.115.19"), started: true },
            { runId: "urgiis", claims: urg("66.42.115.19"), started: false },
          ],
          held: [],
          retryAt: null,
        },
      ],
      [{ runId: "pratt", failed: true }, "timeout"],
    );

    await expect(runIngestionPass(operations)).rejects.toThrow(
      "Waited for more reports",
    );

    expect(events).toEqual([
      "plan:active",
      "start:pratt",
      "report:pratt",
      `deadline:${FAILED_RUN_RESUME_DELAY_MS}`,
      "timeout",
      "plan:active",
      "start:pratt",
    ]);
  });

  test("starts each run with the claims it may fetch with", async () => {
    const { operations, startedWith } = passOperations(
      [
        {
          status: "active",
          runs: [
            { runId: "aviation", claims: urg("aws"), started: false },
            // Attached before this pass: it may hold every lane it might
            // reach, but may fetch only from those no other run holds.
            {
              runId: "urgiis",
              claims: urg("chucks", "66.42.115.19", "norbs"),
              started: true,
            },
            { runId: "pratt", claims: urg("66.42.115.19"), started: true },
          ],
          held: [],
          retryAt: null,
        },
      ],
      [],
    );

    await expect(runIngestionPass(operations)).rejects.toThrow(
      "Waited for more reports",
    );

    expect(startedWith).toEqual([
      ["aviation", ["aws"]],
      ["urgiis", ["chucks", "norbs"]],
      ["pratt", []],
    ]);
  });
});

describe("runIngestionPass with a stale hand-back", () => {
  test("ignores a hand-back from a workflow it already replaced", async () => {
    const urg = (...lanes: string[]): HostClaims => ({
      lanes,
      places: [{ group: "urg", capacity: 3 }],
    });
    const { operations, events, startedWith } = passOperations(
      [
        {
          status: "active",
          runs: [
            { runId: "urgiis", claims: urg("eagle"), started: false },
            { runId: "pratt", claims: urg("66.42.115.19"), started: false },
          ],
          held: [],
          retryAt: null,
        },
      ],
      [
        { runId: "urgiis", yielded: urg("linders"), admitted: urg("eagle") },
        { runId: "pratt", fetched: true },
        // Its next workflow, admitted for Linders, now reads Lambert.
        {
          runId: "urgiis",
          yielded: urg("66.42.115.19"),
          admitted: urg("linders"),
        },
        // The first workflow's report, delivered again late.
        { runId: "urgiis", yielded: urg("linders"), admitted: urg("eagle") },
        { runId: "pratt", failed: false },
      ],
    );

    await expect(runIngestionPass(operations)).rejects.toThrow(
      "Waited for more reports",
    );

    expect(events.filter((event) => event.startsWith("start:"))).toEqual([
      "start:urgiis,pratt",
      "start:urgiis",
      "start:urgiis",
    ]);
    expect(startedWith.at(-1)).toEqual(["urgiis", ["66.42.115.19"]]);
  });
});

describe("runIngestionPass with a hand-back from a run it did not admit", () => {
  test("plans again instead of trusting it, since a later workflow may be fetching", async () => {
    const urg = (...lanes: string[]): HostClaims => ({
      lanes,
      places: [{ group: "urg", capacity: 3 }],
    });
    const { operations, events } = passOperations(
      [
        {
          status: "active",
          runs: [
            // Started by the previous day's pass, which already re-admitted
            // it for Lambert.
            { runId: "urgiis", claims: urg("66.42.115.19"), started: true },
            { runId: "pratt", claims: urg("66.42.115.19"), started: false },
          ],
          held: [],
          retryAt: null,
        },
        { status: "complete" },
      ],
      [
        // A duplicate of an earlier workflow's report.
        {
          runId: "urgiis",
          yielded: urg("66.42.115.19"),
          admitted: urg("higgins"),
        },
      ],
    );

    await runIngestionPass(operations);

    expect(events).toEqual([
      "plan:active",
      "start:urgiis",
      "yielded:urgiis",
      "plan:complete",
      "deliver",
    ]);
  });
});

describe("runIngestionPass with a run stopped mid-fetch", () => {
  test("starts nothing on its lanes until its last chunk must have ended", async () => {
    const pratt: HostClaims = {
      lanes: ["66.42.115.19"],
      places: [{ group: "urg", capacity: 2 }],
    };
    const { operations, events } = passOperations(
      [
        {
          status: "active",
          runs: [{ runId: "pratt-again", claims: pratt, started: false }],
          held: [pratt],
          retryAt: 360_000,
        },
        {
          status: "active",
          runs: [{ runId: "pratt-again", claims: pratt, started: false }],
          held: [],
          retryAt: null,
        },
        { status: "complete" },
      ],
      ["timeout", { runId: "pratt-again", failed: false }],
    );

    await runIngestionPass(operations);

    expect(events.slice(0, 5)).toEqual([
      "plan:active",
      "deadline:360000",
      "timeout",
      "plan:active",
      "start:pratt-again",
    ]);
  });
});

describe("runIngestionPass watchdog", () => {
  test("re-plans on an interval only while runs wait for hosts", async () => {
    const aws: HostClaims = {
      lanes: ["aws"],
      places: [{ group: "urg", capacity: 2 }],
    };
    const { operations, watchdogs } = passOperations(
      [
        {
          status: "active",
          runs: [
            { runId: "aviation", claims: aws, started: false },
            { runId: "central", claims: aws, started: false },
          ],
          held: [],
          retryAt: null,
        },
        { status: "complete" },
      ],
      [
        { runId: "aviation", fetched: true },
        { runId: "aviation", failed: false },
        { runId: "central", failed: false },
      ],
    );

    await runIngestionPass(operations);

    // While central waits, runs reporting to another pass must not hold its
    // lane past an interval; once nothing waits, only silence re-plans.
    expect(watchdogs).toEqual(["interval", "silence", "silence"]);
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
      ["timeout"],
    );

    expect(await runIngestionPass(operations)).toBe("expired");

    expect(events).toEqual([
      "plan:waiting",
      "deadline:2000",
      "timeout",
      "plan:expired",
    ]);
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

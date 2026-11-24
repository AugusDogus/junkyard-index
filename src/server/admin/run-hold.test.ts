import { describe, expect, test } from "bun:test";
import {
  LONG_COMMIT_HOLD_MS,
  RunHold,
  type WorkflowDeployments,
} from "./run-hold";
import type { ActiveRun } from "./source-overview";

const MINUTE = 60 * 1000;
const now = new Date("2026-11-23T23:00:00Z");

function active(overrides: Partial<ActiveRun> & { runId: string }): ActiveRun {
  return {
    source: "pyp",
    stage: "sources",
    workflowRunId: `wrun-${overrides.runId}`,
    startedAt: new Date(now.getTime() - 6 * 60 * MINUTE),
    lastProgressAt: now,
    readyAt: null,
    commitStartedAt: null,
    ...overrides,
  };
}

const current: WorkflowDeployments = {
  status: "read",
  current: "dpl_new",
  byWorkflowRun: new Map(),
};

describe("RunHold.assess", () => {
  test("the commit holder carries the runs queued behind it and since when", () => {
    const heldSince = new Date(now.getTime() - 12 * 60 * MINUTE - 23 * MINUTE);
    const firstQueued = new Date(now.getTime() - 11 * 60 * MINUTE);
    const holds = RunHold.assess({
      now,
      deployments: current,
      activeRuns: [
        active({
          runId: "holder",
          source: "hollanderstores",
          stage: "reconcile_upsert",
          commitStartedAt: heldSince,
        }),
        active({
          runId: "waiter-1",
          source: "urgiis",
          stage: "validated",
          readyAt: firstQueued,
        }),
        // Validated by earlier code: it queued when it last progressed.
        active({
          runId: "waiter-2",
          source: "row52",
          stage: "validated",
          lastProgressAt: new Date(now.getTime() - 3 * 60 * MINUTE),
        }),
        // Still crawling, so not queued for the commit yet.
        active({ runId: "crawling", source: "pullapart" }),
      ],
    });
    const holder = holds.find((hold) => hold.run.runId === "holder");
    expect(holder?.commit).toEqual({
      since: heldSince,
      heldMs: 12 * 60 * MINUTE + 23 * MINUTE,
      long: true,
      queue: {
        status: "waiting",
        runs: 2,
        since: firstQueued,
        waitedMs: 11 * 60 * MINUTE,
      },
    });
    expect(holder?.name).toBe("Hollander Stores");
    expect(holder?.source).toBe("hollanderstores");
    expect(
      holds
        .filter((hold) => hold.commit !== null)
        .map((hold) => hold.run.runId),
    ).toEqual(["holder"]);
  });

  test("a commit held for an hour or less is not long", () => {
    const [hold] = RunHold.assess({
      now,
      deployments: current,
      activeRuns: [
        active({
          runId: "holder",
          stage: "reconcile_upsert",
          commitStartedAt: new Date(now.getTime() - LONG_COMMIT_HOLD_MS),
        }),
      ],
    });
    expect(hold?.commit?.long).toBe(false);
    expect(hold?.commit?.queue).toEqual({ status: "empty" });
  });

  test("names each run's deployment against the one serving the page", () => {
    const holds = RunHold.assess({
      now,
      deployments: {
        status: "read",
        current: "dpl_new",
        byWorkflowRun: new Map([
          ["wrun-old", "dpl_old"],
          ["wrun-same", "dpl_new"],
        ]),
      },
      activeRuns: [
        active({ runId: "old" }),
        active({ runId: "same", source: "row52" }),
        // Not listed live (its workflow ended or predates the listing).
        active({ runId: "unlisted", source: "pullapart" }),
        active({ runId: "detached", source: "urgiis", workflowRunId: null }),
      ],
    });
    expect(
      Object.fromEntries(
        holds.map((hold) => [hold.run.runId, hold.deployment]),
      ),
    ).toEqual({
      old: { kind: "other", deploymentId: "dpl_old" },
      same: { kind: "current" },
      unlisted: { kind: "unknown" },
      detached: { kind: "unknown" },
    });
  });

  test("every deployment is unknown when the listing could not be read", () => {
    const [hold] = RunHold.assess({
      now,
      deployments: {
        status: "unavailable",
        message: "no VERCEL_DEPLOYMENT_ID",
      },
      activeRuns: [active({ runId: "old" })],
    });
    expect(hold?.deployment).toEqual({ kind: "unknown" });
  });

  test("each run counts the other active runs off current code", () => {
    const holds = RunHold.assess({
      now,
      deployments: {
        status: "read",
        current: "dpl_new",
        byWorkflowRun: new Map([
          ["wrun-stuck", "dpl_old"],
          ["wrun-waiter-1", "dpl_old"],
          ["wrun-waiter-2", "dpl_older"],
          ["wrun-fresh", "dpl_new"],
        ]),
      },
      activeRuns: [
        active({ runId: "stuck", stage: "full_reindex_load" }),
        active({ runId: "waiter-1", stage: "validated" }),
        active({ runId: "waiter-2", stage: "validated" }),
        active({ runId: "fresh" }),
        active({ runId: "unlisted" }),
      ],
    });
    expect(holds[0]?.otherCode).toEqual({
      other: 2,
      deploymentIds: ["dpl_old", "dpl_older"],
      unknown: 1,
    });
    expect(holds[3]?.otherCode).toEqual({
      other: 3,
      deploymentIds: ["dpl_old", "dpl_older"],
      unknown: 1,
    });
  });

  test("a run across every source has no source to run again", () => {
    const [hold] = RunHold.assess({
      now,
      deployments: current,
      activeRuns: [active({ runId: "local", source: "all" })],
    });
    expect(hold?.source).toBeNull();
    expect(hold?.name).toBe("Every source");
  });
});

describe("RunHold.readDeployments", () => {
  const live = async () => [{ runId: "wrun-a", deploymentId: "dpl_old" }];

  test("matches live workflows to the deployment serving the page", async () => {
    expect(
      await RunHold.readDeployments({
        current: "dpl_new",
        runs: [active({ runId: "a" })],
        listLiveRuns: live,
        timeoutMs: 1000,
      }),
    ).toEqual({
      status: "read",
      current: "dpl_new",
      byWorkflowRun: new Map([["wrun-a", "dpl_old"]]),
    });
  });

  test("lists nothing off Vercel or when no run has a workflow", async () => {
    let listings = 0;
    const counted = async () => {
      listings += 1;
      return live();
    };
    expect(
      await RunHold.readDeployments({
        current: undefined,
        runs: [active({ runId: "a" })],
        listLiveRuns: counted,
        timeoutMs: 1000,
      }),
    ).toMatchObject({ status: "unavailable" });
    for (const runs of [[], [active({ runId: "a", workflowRunId: null })]]) {
      expect(
        await RunHold.readDeployments({
          current: "dpl_new",
          runs,
          listLiveRuns: counted,
          timeoutMs: 1000,
        }),
      ).toEqual({
        status: "read",
        current: "dpl_new",
        byWorkflowRun: new Map(),
      });
    }
    expect(listings).toBe(0);
  });

  test("a listing that fails or does not answer in time leaves every run unknown", async () => {
    expect(
      await RunHold.readDeployments({
        current: "dpl_new",
        runs: [active({ runId: "a" })],
        listLiveRuns: async () => {
          throw new Error("workflow backend returned 503");
        },
        timeoutMs: 1000,
      }),
    ).toEqual({
      status: "unavailable",
      message: "workflow backend returned 503",
    });
    expect(
      await RunHold.readDeployments({
        current: "dpl_new",
        runs: [active({ runId: "a" })],
        listLiveRuns: () => new Promise(() => undefined),
        timeoutMs: 5,
      }),
    ).toEqual({
      status: "unavailable",
      message:
        "The workflow backend did not list live ingestion workflows within 0.005 s, so every run's code version shows as unknown.",
    });
  });
});

describe("RunHold.attention", () => {
  test("a long commit hold says how long and what queues behind it", () => {
    const items = RunHold.attention(
      RunHold.assess({
        now,
        deployments: {
          status: "read",
          current: "dpl_new",
          byWorkflowRun: new Map([["wrun-holder", "dpl_old"]]),
        },
        activeRuns: [
          active({
            runId: "holder",
            source: "hollanderstores",
            stage: "reconcile_upsert",
            commitStartedAt: new Date(
              now.getTime() - 12 * 60 * MINUTE - 23 * MINUTE,
            ),
          }),
          active({
            runId: "waiter",
            source: "urgiis",
            stage: "validated",
            readyAt: new Date(now.getTime() - 90 * MINUTE),
          }),
        ],
      }),
    );
    expect(items).toEqual([
      {
        title:
          "Hollander Stores's run has held the publish slot for 12 h 23 min",
        detail:
          "Only one run publishes at a time. 1 run has finished crawling and is waiting behind it, the first for 1 h 30 min; each also keeps its source from starting a new run. It is at the reconcile_upsert stage and runs code from another deployment (dpl_old), not the current one, so fixes deployed since it started do not reach it.",
        href: "/admin/sources/hollanderstores",
        runs: [
          {
            runId: "holder",
            name: "Hollander Stores",
            source: "hollanderstores",
            stage: "reconcile_upsert",
            deployment: { kind: "other", deploymentId: "dpl_old" },
            // The waiter's workflow is not in the listing.
            otherCode: { other: 0, deploymentIds: [], unknown: 1 },
          },
        ],
      },
    ]);
  });

  test("groups runs on another deployment, leaving out a holder already listed", () => {
    const items = RunHold.attention(
      RunHold.assess({
        now,
        deployments: {
          status: "read",
          current: "dpl_new",
          byWorkflowRun: new Map([
            ["wrun-holder", "dpl_old"],
            ["wrun-a", "dpl_old"],
            ["wrun-b", "dpl_older"],
            ["wrun-c", "dpl_new"],
          ]),
        },
        activeRuns: [
          active({
            runId: "holder",
            source: "hollanderstores",
            stage: "reconcile_upsert",
            commitStartedAt: new Date(now.getTime() - 2 * 60 * MINUTE),
          }),
          active({ runId: "b", source: "row52" }),
          active({ runId: "a", source: "pyp", stage: "validated" }),
          active({ runId: "c", source: "pullapart" }),
        ],
      }),
    );
    expect(items.map((item) => item.title)).toEqual([
      "Hollander Stores's run has held the publish slot for 2 h 0 min",
      "2 runs run code from another deployment",
    ]);
    expect(items[1]).toMatchObject({
      href: "/admin/sources/pyp",
      runs: [
        { runId: "a", name: "LKQ Pick Your Part", stage: "validated" },
        { runId: "b", name: "Row52", stage: "sources" },
      ],
    });
    expect(items[1]?.detail).toBe(
      "Workflow runs keep the code they started on, so fixes deployed since do not reach them. Most finish on their own. Stop one that is stuck or holding others up; Stop and run again restarts it on current code.",
    );
  });

  test("nothing needs attention while runs are on current code and publish promptly", () => {
    expect(
      RunHold.attention(
        RunHold.assess({
          now,
          deployments: {
            status: "read",
            current: "dpl_new",
            byWorkflowRun: new Map([["wrun-holder", "dpl_new"]]),
          },
          activeRuns: [
            active({
              runId: "holder",
              stage: "reconcile_upsert",
              commitStartedAt: new Date(now.getTime() - 10 * MINUTE),
            }),
            active({ runId: "unlisted", source: "row52" }),
          ],
        }),
      ),
    ).toEqual([]);
  });
});

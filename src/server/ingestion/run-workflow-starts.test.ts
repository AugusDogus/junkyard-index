import { describe, expect, test } from "bun:test";
import {
  StartingMark,
  startGuarded,
  startIdleRunWorkflows,
  type RunWorkflowState,
} from "./run-workflow-starts";

describe("startIdleRunWorkflows", () => {
  test("starts only runs whose attached workflow is not live", async () => {
    const states: Record<string, RunWorkflowState> = {
      "wrun-live": "live",
      "wrun-done": "idle",
      "wrun-unreadable": "unknown",
    };
    const started: string[] = [];
    const result = await startIdleRunWorkflows({
      runIds: ["live", "finished", "unattached", "unreadable"],
      attachedWorkflows: async () =>
        new Map([
          ["live", "wrun-live"],
          ["finished", "wrun-done"],
          ["unreadable", "wrun-unreadable"],
        ]),
      workflowState: async (workflowRunId) => {
        const state = states[workflowRunId];
        if (!state) throw new Error(`Unexpected workflow ${workflowRunId}`);
        return state;
      },
      passRunId: "wrun-pass",
      now: () => 0,
      start: async (runId) => {
        started.push(runId);
      },
    });

    expect(result).toEqual({
      started: ["finished", "unattached", "unreadable"],
      live: ["live"],
    });
    expect(started.sort()).toEqual(["finished", "unattached", "unreadable"]);
  });
});

describe("startIdleRunWorkflows with a starting mark", () => {
  test("treats another pass's fresh mark as a start in flight and an old one as idle", async () => {
    const now = 10 * 60_000;
    const starts: Array<[string, string | null, string]> = [];
    const fresh = StartingMark.of("wrun-other-pass", now - 1_000);
    const stale = StartingMark.of(
      "wrun-other-pass",
      now - StartingMark.GRACE_MS,
    );
    const result = await startIdleRunWorkflows({
      runIds: ["fresh", "stale", "unattached"],
      attachedWorkflows: async () =>
        new Map([
          ["fresh", fresh],
          ["stale", stale],
        ]),
      workflowState: async () => {
        throw new Error("A mark is not a workflow");
      },
      passRunId: "wrun-pass",
      now: () => now,
      start: async (runId, previous, state) => {
        starts.push([runId, previous, state]);
      },
    });
    expect(result.live).toEqual(["fresh"]);
    expect(starts).toEqual([
      ["stale", stale, "idle"],
      ["unattached", null, "idle"],
    ]);
  });

  test("starts again a run its own pass marked, as a retried start step does", async () => {
    // The step's first attempt marked the run, then start() failed.
    const own = StartingMark.of("wrun-pass", 9_000);
    const starts: Array<[string, string | null, string]> = [];
    await startIdleRunWorkflows({
      runIds: ["run"],
      attachedWorkflows: async () => new Map([["run", own]]),
      workflowState: async () => {
        throw new Error("A mark is not a workflow");
      },
      passRunId: "wrun-pass",
      now: () => 10_000,
      start: async (runId, previous, state) => {
        starts.push([runId, previous, state]);
      },
    });
    expect(starts).toEqual([["run", own, "idle"]]);
  });
});

describe("startGuarded", () => {
  function deps(overrides: Partial<Parameters<typeof startGuarded>[0]> = {}) {
    const events: string[] = [];
    const params: Parameters<typeof startGuarded>[0] = {
      runId: "run",
      previous: null,
      state: "idle",
      passRunId: "wrun-pass",
      now: () => 5,
      swap: async (_runId, from, to) => {
        events.push(`swap:${from}->${to}`);
        return true;
      },
      stillAdmits: async () => {
        events.push("owner?");
        return true;
      },
      start: async () => {
        events.push("start");
        return "wrun-new";
      },
      ...overrides,
    };
    return { params, events };
  }

  test("marks the run before starting it, then attaches the new workflow", async () => {
    const { params, events } = deps();
    expect(await startGuarded(params)).toBe("started");
    expect(events).toEqual([
      "swap:null->starting:wrun-pass:5",
      "owner?",
      "start",
      "swap:starting:wrun-pass:5->wrun-new",
    ]);
  });

  test("starts nothing once its pass no longer admits, and clears its mark", async () => {
    const { params, events } = deps({
      previous: "wrun-old",
      stillAdmits: async () => {
        events.push("owner?");
        return false;
      },
    });
    expect(await startGuarded(params)).toBe("skipped");
    expect(events).toEqual([
      "swap:wrun-old->starting:wrun-pass:5",
      "owner?",
      "swap:starting:wrun-pass:5->wrun-old",
    ]);
  });

  test("starts nothing when another start attached the run first", async () => {
    const { params, events } = deps({
      swap: async (_runId, from, to) => {
        events.push(`swap:${from}->${to}`);
        return false;
      },
    });
    expect(await startGuarded(params)).toBe("skipped");
    expect(events).toEqual(["swap:null->starting:wrun-pass:5"]);
  });

  test("starts a run whose workflow state is unknown without replacing its id", async () => {
    // A live workflow deduplicates the start; the new one attaches itself.
    const { params, events } = deps({
      previous: "wrun-maybe",
      state: "unknown",
    });
    expect(await startGuarded(params)).toBe("started");
    expect(events).toEqual(["owner?", "start"]);
  });
});

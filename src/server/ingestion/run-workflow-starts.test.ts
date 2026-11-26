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
  test("treats a fresh mark as a start in flight and an old one as idle", async () => {
    const now = 10 * 60_000;
    const starts: Array<[string, string | null, string]> = [];
    const result = await startIdleRunWorkflows({
      runIds: ["fresh", "stale", "unattached"],
      attachedWorkflows: async () =>
        new Map([
          ["fresh", StartingMark.of(now - 1_000)],
          ["stale", StartingMark.of(now - StartingMark.GRACE_MS)],
        ]),
      workflowState: async () => {
        throw new Error("A mark is not a workflow");
      },
      now: () => now,
      start: async (runId, previous, state) => {
        starts.push([runId, previous, state]);
      },
    });
    expect(result.live).toEqual(["fresh"]);
    expect(starts).toEqual([
      ["stale", StartingMark.of(now - StartingMark.GRACE_MS), "idle"],
      ["unattached", null, "idle"],
    ]);
  });
});

describe("startGuarded", () => {
  function deps(overrides: Partial<Parameters<typeof startGuarded>[0]> = {}) {
    const events: string[] = [];
    const params: Parameters<typeof startGuarded>[0] = {
      runId: "run",
      previous: null,
      state: "idle",
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
      "swap:null->starting:5",
      "owner?",
      "start",
      "swap:starting:5->wrun-new",
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
      "swap:wrun-old->starting:5",
      "owner?",
      "swap:starting:5->wrun-old",
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
    expect(events).toEqual(["swap:null->starting:5"]);
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

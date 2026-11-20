import { describe, expect, test } from "bun:test";
import {
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

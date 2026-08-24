import { describe, expect, test } from "bun:test";
import {
  drainDurableCleanup,
  drainDurablePhase,
  runDurablePublicationLifecycle,
} from "./durable-post-ingestion-orchestrator";

describe("durable post-ingestion orchestration", () => {
  test("drains resumable phases and reports health after publication", async () => {
    const events: string[] = [];
    let projectionCalls = 0;
    let matchingCalls = 0;
    const result = await runDurablePublicationLifecycle({
      runId: "run-1",
      project: (runId) =>
        drainDurablePhase(async () => {
          events.push(`project:${runId}`);
          projectionCalls += 1;
          return {
            status: projectionCalls === 2 ? "complete" : "paused",
          } as const;
        }),
      matchAlerts: (runId) =>
        drainDurablePhase(async () => {
          events.push(`match:${runId}`);
          matchingCalls += 1;
          return {
            status: matchingCalls === 2 ? "complete" : "paused",
          } as const;
        }),
      reportHealth: async (runId) => {
        events.push(`health:${runId}`);
      },
    });

    expect(result.status).toBe("completed");
    expect(events).toEqual([
      "project:run-1",
      "project:run-1",
      "match:run-1",
      "match:run-1",
      "health:run-1",
    ]);
  });

  test("does not enter alert matching after projection is stopped", async () => {
    let matchingCalls = 0;
    const result = await runDurablePublicationLifecycle({
      runId: "run-1",
      project: async () => ({ status: "stopped" as const }),
      matchAlerts: async () => {
        matchingCalls += 1;
        return { status: "complete" as const };
      },
      reportHealth: async () => undefined,
    });

    expect(result).toEqual({ status: "stopped", phase: "projection" });
    expect(matchingCalls).toBe(0);
  });

  test("calls the health reporter without the lifecycle parameters as its receiver", async () => {
    const healthReporterReceivers: unknown[] = [];

    await runDurablePublicationLifecycle({
      runId: "run-1",
      project: async () => ({ status: "complete" as const }),
      matchAlerts: async () => ({ status: "complete" as const }),
      reportHealth: async function (this: unknown) {
        healthReporterReceivers.push(this);
      },
    });

    expect(healthReporterReceivers).toEqual([undefined]);
  });

  test("drains cleanup until its durable cursor is complete", async () => {
    let calls = 0;
    await drainDurableCleanup(async () => {
      calls += 1;
      return { done: calls === 3 };
    });
    expect(calls).toBe(3);
  });
});

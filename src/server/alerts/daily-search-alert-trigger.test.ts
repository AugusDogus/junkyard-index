import { describe, expect, test } from "bun:test";
import {
  isPastSearchAlertDeadline,
  runSearchAlertCheck,
  startDailySearchAlerts,
} from "./daily-search-alert-trigger";
import type { SearchAlertCheckBatchResult } from "./search-alert-check";

function trigger(state: { pending: boolean; deliverable: boolean }) {
  const started: string[] = [];
  return {
    started,
    operations: (now: Date) => ({
      now,
      isCheckPending: async () => state.pending,
      hasDeliverableIntents: async () => state.deliverable,
      startCheck: async (day: string) => {
        started.push(`check:${day}`);
      },
      startDelivery: async () => {
        started.push("delivery");
      },
    }),
  };
}

const DAY = "2026-11-20";
const DURING_DAY = new Date("2026-11-20T19:00:00Z");

describe("daily search alert trigger", () => {
  test("starts a pending check and, independently, delivery of intents that can go out", async () => {
    const { started, operations } = trigger({
      pending: true,
      deliverable: true,
    });
    expect(await startDailySearchAlerts(DAY, operations(DURING_DAY))).toEqual({
      check: true,
      delivery: true,
    });
    expect(started).toEqual([`check:${DAY}`, "delivery"]);
  });

  test("a finished check only starts delivery, and only when something can go out", async () => {
    const finished = trigger({ pending: false, deliverable: true });
    expect(
      await startDailySearchAlerts(DAY, finished.operations(DURING_DAY)),
    ).toEqual({ check: false, delivery: true });
    expect(finished.started).toEqual(["delivery"]);

    const idle = trigger({ pending: false, deliverable: false });
    expect(
      await startDailySearchAlerts(DAY, idle.operations(DURING_DAY)),
    ).toEqual({ check: false, delivery: false });
    expect(idle.started).toEqual([]);
  });

  test("a past day starts no check but still delivers", async () => {
    const { started, operations } = trigger({
      pending: true,
      deliverable: true,
    });
    // 07:00 UTC starts the next ingestion day.
    const nextDay = new Date("2026-11-21T07:00:00Z");
    expect(await startDailySearchAlerts(DAY, operations(nextDay))).toEqual({
      check: false,
      delivery: true,
    });
    expect(started).toEqual(["delivery"]);
  });

  test("the deadline is 18:00 UTC within the 07:00 UTC ingestion day", () => {
    expect(
      isPastSearchAlertDeadline(new Date("2026-11-20T17:59:59.999Z")),
    ).toBe(false);
    expect(isPastSearchAlertDeadline(new Date("2026-11-20T18:00:00Z"))).toBe(
      true,
    );
    expect(isPastSearchAlertDeadline(new Date("2026-11-21T06:59:59Z"))).toBe(
      true,
    );
    expect(isPastSearchAlertDeadline(new Date("2026-11-21T07:00:00Z"))).toBe(
      false,
    );
  });
});

describe("search alert check run", () => {
  function drain(batches: SearchAlertCheckBatchResult[]) {
    const events: string[] = [];
    const queue = [...batches];
    return {
      events,
      run: () =>
        runSearchAlertCheck({
          runBatch: async () => {
            const batch = queue.shift();
            if (!batch) throw new Error("Unexpected extra batch");
            events.push(`batch:${batch.status}`);
            return batch;
          },
          waitForRetry: async () => {
            events.push("wait");
          },
          startDelivery: async () => {
            events.push("delivery");
          },
        }),
    };
  }

  test("waits out blocked batches, sums progress and delivers once complete", async () => {
    const { events, run } = drain([
      { status: "waiting", checkId: "check" },
      {
        status: "paused",
        checkId: "check",
        searchesProcessed: 50,
        intentsCreated: 2,
      },
      { status: "waiting", checkId: "check" },
      {
        status: "complete",
        checkId: "check",
        searchesProcessed: 3,
        intentsCreated: 1,
      },
    ]);
    expect(await run()).toEqual({
      status: "completed",
      searchesProcessed: 53,
      intentsCreated: 3,
    });
    expect(events).toEqual([
      "batch:waiting",
      "wait",
      "batch:paused",
      "batch:waiting",
      "wait",
      "batch:complete",
      "delivery",
    ]);
  });

  test("a superseded or never-started check still delivers earlier intents", async () => {
    for (const batch of [
      { status: "stopped", checkId: "check" },
      { status: "not_started" },
    ] satisfies SearchAlertCheckBatchResult[]) {
      const { events, run } = drain([batch]);
      expect(await run()).toEqual({ status: batch.status });
      expect(events).toEqual([`batch:${batch.status}`, "delivery"]);
    }
  });
});

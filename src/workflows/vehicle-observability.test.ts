import { describe, expect, test } from "bun:test";
import type * as Sentry from "@sentry/nextjs";
import {
  DurableSourceFailure,
  recordDurableSourceFailure,
} from "./vehicle-observability";

describe("vehicle ingestion observability", () => {
  test("reports a structured terminal source failure after the durable write", async () => {
    const operations: string[] = [];
    const captured: Parameters<typeof Sentry.captureMessage>[] = [];
    const captureMessage: typeof Sentry.captureMessage = (message, context) => {
      operations.push("capture");
      captured.push([message, context]);
      return "event-id";
    };
    const failure = DurableSourceFailure.make({
      runId: "workflow-run-123",
      source: "gopullit",
      message: "gopullit ingestion failed: catalog limit exceeded",
    });

    const result = await recordDurableSourceFailure({
      failure,
      markFailed: async () => {
        operations.push("mark");
        return { status: "failed" as const };
      },
      captureMessage,
    });

    expect(result).toEqual({ status: "failed" });
    expect(operations).toEqual(["mark", "capture"]);
    expect(captured).toHaveLength(1);
    const capturedEvent = captured[0];
    if (capturedEvent === undefined) throw new Error("Missing captured event");
    expect(capturedEvent[0]).toBe(
      "gopullit ingestion failed: catalog limit exceeded",
    );
    expect(capturedEvent[1]).toMatchObject({
      tags: {
        failure_category: "vehicle-ingestion-source-failed",
        ingestion_source: "gopullit",
        workflow: "vehicle-ingestion",
      },
      extra: { runId: "workflow-run-123" },
    });
  });

  test("does not report when the durable failure write fails", async () => {
    let captured = false;
    const captureMessage: typeof Sentry.captureMessage = () => {
      captured = true;
      return "event-id";
    };

    await expect(
      recordDurableSourceFailure({
        failure: DurableSourceFailure.make({
          runId: "workflow-run-123",
          source: "gopullit",
          message: "failed",
        }),
        markFailed: () => Promise.reject(new Error("database unavailable")),
        captureMessage,
      }),
    ).rejects.toThrow("database unavailable");
    expect(captured).toBe(false);
  });
});

import { describe, expect, spyOn, test } from "bun:test";
import type * as Sentry from "@sentry/nextjs";
import {
  recordDurableRunFailure,
  recordDurableSourceRejections,
  recordUrgiisBlockedTenant,
} from "./vehicle-observability";
import { UrgiisCursor } from "~/server/ingestion/urgiis-cursor";
import { URGIIS_TENANTS } from "~/server/ingestion/urgiis-configuration";

describe("vehicle ingestion observability", () => {
  test("reports failed-result and validation rejections after the durable write", async () => {
    const operations: string[] = [];
    const captured: Parameters<typeof Sentry.captureMessage>[] = [];
    const result = await recordDurableSourceRejections({
      runId: "workflow-run-123",
      validate: async () => {
        operations.push("validate");
        return {
          status: "ready" as const,
          acceptedSources: ["row52" as const],
          rejectedSources: [
            { source: "pyp" as const, errors: ["PYP curl exit 56"] },
            { source: "pullnsave" as const, errors: ["Inventory too small"] },
          ],
        };
      },
      captureMessage: (message, context) => {
        operations.push("capture");
        captured.push([message, context]);
        return "event-id";
      },
    });

    expect(result.status).toBe("ready");
    expect(operations).toEqual(["validate", "capture", "capture"]);
    expect(captured).toHaveLength(2);
    expect(captured[0]).toMatchObject([
      "pyp ingestion rejected",
      {
        level: "error",
        fingerprint: ["vehicle-ingestion-source-rejected", "pyp"],
        tags: {
          failure_category: "vehicle-ingestion-source-rejected",
          ingestion_source: "pyp",
          workflow: "vehicle-ingestion",
        },
        extra: {
          runId: "workflow-run-123",
          errors: ["PYP curl exit 56"],
        },
      },
    ]);
    expect(captured[1]?.[1]).toMatchObject({
      tags: { ingestion_source: "pullnsave" },
      extra: { errors: ["Inventory too small"] },
    });
  });

  test("does not report stopped validation or a failed durable write", async () => {
    let captured = false;
    const captureMessage: typeof Sentry.captureMessage = () => {
      captured = true;
      return "event-id";
    };
    const stopped = await recordDurableSourceRejections({
      runId: "workflow-run-123",
      validate: async () => ({ status: "stopped" }),
      captureMessage,
    });
    expect(stopped).toEqual({ status: "stopped" });
    await expect(
      recordDurableSourceRejections({
        runId: "workflow-run-123",
        validate: () => Promise.reject(new Error("database unavailable")),
        captureMessage,
      }),
    ).rejects.toThrow("database unavailable");
    expect(captured).toBe(false);
  });

  test("a Sentry failure does not retry an already committed validation", async () => {
    const reportError = spyOn(console, "error").mockImplementation(() => {});
    let writes = 0;
    try {
      const result = await recordDurableSourceRejections({
        runId: "workflow-run-123",
        validate: async () => {
          writes++;
          return {
            status: "ready" as const,
            acceptedSources: [],
            rejectedSources: [
              { source: "pyp" as const, errors: ["PYP curl exit 56"] },
            ],
          };
        },
        captureMessage: () => {
          throw new Error("Sentry unavailable");
        },
      });
      expect(result.status).toBe("ready");
      expect(writes).toBe(1);
      expect(reportError).toHaveBeenCalledTimes(1);
    } finally {
      reportError.mockRestore();
    }
  });

  test("reports a fatal run failure after the durable write", async () => {
    const operations: string[] = [];
    const captured: Parameters<typeof Sentry.captureMessage>[] = [];
    await recordDurableRunFailure({
      runId: "workflow-run-123",
      message: "Durable ingestion failed: database unavailable",
      markFailed: async () => {
        operations.push("mark");
      },
      captureMessage: (message, context) => {
        operations.push("capture");
        captured.push([message, context]);
        return "event-id";
      },
    });
    expect(operations).toEqual(["mark", "capture"]);
    expect(captured[0]?.[1]).toMatchObject({
      tags: {
        failure_category: "vehicle-ingestion-run-failed",
        workflow: "vehicle-ingestion",
      },
      extra: { runId: "workflow-run-123" },
    });
  });

  test("does not report a run failure before its durable write", async () => {
    let captured = false;
    await expect(
      recordDurableRunFailure({
        runId: "workflow-run-123",
        message: "Durable ingestion failed",
        markFailed: () => Promise.reject(new Error("database unavailable")),
        captureMessage: () => {
          captured = true;
          return "event-id";
        },
      }),
    ).rejects.toThrow("database unavailable");
    expect(captured).toBe(false);
  });

  test("reports each URG IIS tenant a chunk newly blocks, not accepted ones", () => {
    const tenants = URGIIS_TENANTS.slice(0, 3);
    const [first, second] = tenants;
    if (!first || !second) throw new Error("Missing URG tenants");
    const before = UrgiisCursor.nextTenant(
      UrgiisCursor.initial(tenants),
      { code: first.code, accepted: first.minimumInventory },
      tenants,
      "state",
    );
    const blocked = UrgiisCursor.nextTenant(
      before,
      { code: second.code, blocked: "returned HTTP403" },
      tenants,
      "state",
    );
    const captured: Parameters<typeof Sentry.captureMessage>[] = [];
    const capture = (...args: Parameters<typeof Sentry.captureMessage>) => {
      captured.push(args);
      return "event-id";
    };
    recordUrgiisBlockedTenant({
      runId: "run",
      before: UrgiisCursor.initial(tenants),
      after: before,
      captureMessage: capture,
    });
    recordUrgiisBlockedTenant({
      runId: "run",
      before: blocked,
      after: blocked,
      captureMessage: capture,
    });
    expect(captured).toHaveLength(0);
    recordUrgiisBlockedTenant({
      runId: "run",
      before,
      after: blocked,
      captureMessage: capture,
    });
    expect(captured).toEqual([
      [
        `urgiis tenant ${second.code} blocked; its yards keep their previous inventory`,
        expect.objectContaining({
          level: "warning",
          fingerprint: ["vehicle-ingestion-urgiis-tenant-blocked", second.code],
          extra: { runId: "run", reason: "returned HTTP403" },
        }),
      ],
    ]);
  });
});

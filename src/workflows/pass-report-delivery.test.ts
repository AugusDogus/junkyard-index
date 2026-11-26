import { describe, expect, test } from "bun:test";
import {
  HookNotFoundError,
  RunExpiredError,
  WorkflowWorldError,
} from "workflow/internal/errors";
import { deliverPassReport } from "./pass-report-delivery";

describe("deliverPassReport", () => {
  test("sends the report to the current ingestion day's pass", async () => {
    const tokens: string[] = [];
    expect(
      await deliverPassReport({
        report: { runId: "run", fetched: true },
        now: new Date("2026-11-26T06:59:00.000Z"),
        resume: async (token) => {
          tokens.push(token);
        },
      }),
    ).toBe("delivered");
    expect(tokens).toEqual(["vehicle-ingestion-pass:2026-11-25"]);
  });

  test("drops the report when no pass is listening, since its next plan sees the run", async () => {
    for (const error of [
      new HookNotFoundError("vehicle-ingestion-pass:2026-11-25"),
      new RunExpiredError("expired"),
    ])
      expect(
        await deliverPassReport({
          report: { runId: "run", failed: false },
          now: new Date("2026-11-25T08:00:00.000Z"),
          resume: async () => {
            throw error;
          },
        }),
      ).toBe("no_pass");
  });

  test("rethrows any other failure so the step retries", async () => {
    await expect(
      deliverPassReport({
        report: { runId: "run", fetched: true },
        now: new Date("2026-11-25T08:00:00.000Z"),
        resume: async () => {
          throw new WorkflowWorldError("503 from the workflow backend");
        },
      }),
    ).rejects.toThrow("503");
  });
});

import { describe, expect, mock, test } from "bun:test";
import {
  ManualIngestionRun,
  type ManualIngestionRunDependencies,
} from "./manual-ingestion-run";

function dependencies(
  overrides: Partial<ManualIngestionRunDependencies> = {},
): ManualIngestionRunDependencies {
  return {
    pauseCause: async () => null,
    startRun: async () => ({ status: "started", runId: "run-1" }),
    startWorkflow: async () => ({ via: "workflow", runId: "wrun-1" }),
    ...overrides,
  };
}

describe("ManualIngestionRun.start", () => {
  test("starts the run and its workflow", async () => {
    expect(
      await ManualIngestionRun.start(dependencies(), "pyp", "admin"),
    ).toEqual({
      status: "started",
      source: "pyp",
      runId: "run-1",
      workflowRunId: "wrun-1",
      via: "workflow",
    });
  });

  test("hands a source that shares a host to the daily pass and says so", async () => {
    const startWorkflow = mock(async () => ({
      via: "pass" as const,
      runId: "wrun-pass",
    }));
    const started = await ManualIngestionRun.start(
      dependencies({ startWorkflow }),
      "central",
      "admin",
    );
    expect(started).toEqual({
      status: "started",
      source: "central",
      runId: "run-1",
      workflowRunId: "wrun-pass",
      via: "pass",
    });
    expect(startWorkflow).toHaveBeenCalledWith("run-1", "central");
    if (started.status !== "started") throw new Error("Expected a start");
    expect(ManualIngestionRun.startNote(started)).toBe(
      " The daily pass starts it once the rate-limited hosts it shares with other sources are free.",
    );
  });

  test("says when the daily pass was restarted on current code", async () => {
    const started = await ManualIngestionRun.start(
      dependencies({
        startWorkflow: async () => ({
          via: "restarted_pass" as const,
          runId: "wrun-new-pass",
        }),
      }),
      "urgiis",
      "admin",
    );
    if (started.status !== "started") throw new Error("Expected a start");
    expect(ManualIngestionRun.startNote(started)).toBe(
      " The daily pass was running older code, so it was restarted on current code; it starts this run once the rate-limited hosts it shares with other sources are free.",
    );
  });

  test("refuses a retired source before reading anything", async () => {
    const pauseCause = mock(async () => null);
    const startRun = mock(async () => ({
      status: "started" as const,
      runId: "run-1",
    }));
    expect(
      await ManualIngestionRun.start(
        dependencies({ pauseCause, startRun }),
        "brandywine",
        "cron_api",
      ),
    ).toEqual({ status: "retired", source: "brandywine" });
    expect(pauseCause).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
  });

  test("the admin control refuses a paused source and says what paused it", async () => {
    const startRun = mock(async () => ({
      status: "started" as const,
      runId: "run-1",
    }));
    for (const cause of ["admin", "flag", "admin_and_flag"] as const) {
      expect(
        await ManualIngestionRun.start(
          dependencies({ pauseCause: async () => cause, startRun }),
          "pratt",
          "admin",
        ),
      ).toEqual({ status: "paused", source: "pratt", cause });
    }
    expect(startRun).not.toHaveBeenCalled();
  });

  test("the cron-secret API refuses a source the owner paused", async () => {
    const startRun = mock(async () => ({
      status: "started" as const,
      runId: "run-1",
    }));
    for (const cause of ["admin", "admin_and_flag"] as const) {
      expect(
        await ManualIngestionRun.start(
          dependencies({ pauseCause: async () => cause, startRun }),
          "pratt",
          "cron_api",
        ),
      ).toEqual({ status: "paused", source: "pratt", cause });
    }
    expect(startRun).not.toHaveBeenCalled();
  });

  test("the cron-secret API runs a source only its Vercel flag pauses, to test a fix", async () => {
    expect(
      await ManualIngestionRun.start(
        dependencies({ pauseCause: async () => "flag" }),
        "pratt",
        "cron_api",
      ),
    ).toEqual({
      status: "started",
      source: "pratt",
      runId: "run-1",
      workflowRunId: "wrun-1",
      via: "workflow",
    });
  });

  test("reports a source that already has an active run, and starts no workflow", async () => {
    const startWorkflow = mock(async () => ({
      via: "workflow" as const,
      runId: "wrun-1",
    }));
    expect(
      await ManualIngestionRun.start(
        dependencies({
          startRun: async () => ({ status: "busy" }),
          startWorkflow,
        }),
        "pyp",
        "admin",
      ),
    ).toEqual({ status: "busy", source: "pyp" });
    expect(startWorkflow).not.toHaveBeenCalled();
  });

  test("explains each refusal in plain words", () => {
    expect(
      ManualIngestionRun.message({ status: "busy", source: "pyp" }),
    ).toContain("already has a run in progress");
    expect(
      ManualIngestionRun.message({
        status: "paused",
        source: "pratt",
        cause: "admin_and_flag",
      }),
    ).toContain("paused here and by the Vercel flag ingestion-source-pratt");
    expect(
      ManualIngestionRun.message({
        status: "paused",
        source: "pratt",
        cause: "flag",
      }),
    ).toContain("paused by the Vercel flag ingestion-source-pratt");
    expect(
      ManualIngestionRun.message({ status: "retired", source: "brandywine" }),
    ).toContain("retired");
  });
});

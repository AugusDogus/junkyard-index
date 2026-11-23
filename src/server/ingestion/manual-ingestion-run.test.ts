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
    startWorkflow: async () => ({ runId: "wrun-1" }),
    ...overrides,
  };
}

describe("ManualIngestionRun.start", () => {
  test("starts the run and its workflow", async () => {
    expect(await ManualIngestionRun.start(dependencies(), "pyp")).toEqual({
      status: "started",
      source: "pyp",
      runId: "run-1",
      workflowRunId: "wrun-1",
    });
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
      ),
    ).toEqual({ status: "retired", source: "brandywine" });
    expect(pauseCause).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
  });

  test("refuses a paused source and says what paused it", async () => {
    const startRun = mock(async () => ({
      status: "started" as const,
      runId: "run-1",
    }));
    for (const cause of ["admin", "flag", "admin_and_flag"] as const) {
      expect(
        await ManualIngestionRun.start(
          dependencies({ pauseCause: async () => cause, startRun }),
          "pratt",
        ),
      ).toEqual({ status: "paused", source: "pratt", cause });
    }
    expect(startRun).not.toHaveBeenCalled();
  });

  test("reports a source that already has an active run, and starts no workflow", async () => {
    const startWorkflow = mock(async () => ({ runId: "wrun-1" }));
    expect(
      await ManualIngestionRun.start(
        dependencies({
          startRun: async () => ({ status: "busy" }),
          startWorkflow,
        }),
        "pyp",
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
    ).toContain("paused here and by its Vercel flag");
    expect(
      ManualIngestionRun.message({ status: "retired", source: "brandywine" }),
    ).toContain("retired");
  });
});

import { describe, expect, mock, test } from "bun:test";
import { SourceControl } from "./source-control";
import {
  SourceControlAction,
  type SourceControlActionDependencies,
} from "./source-control-action";

const now = new Date("2026-11-23T15:00:00Z");

function dependencies(
  overrides: Partial<SourceControlActionDependencies> = {},
): SourceControlActionDependencies {
  return {
    apply: async ({ source, change }) =>
      SourceControl.apply(SourceControl.initial(source), change),
    pauseCause: async () => null,
    startRun: async (source) => ({
      status: "started",
      source,
      runId: "run-1",
      workflowRunId: "wrun-1",
    }),
    logRun: async () => undefined,
    expireHiddenSources: () => undefined,
    ...overrides,
  };
}

describe("SourceControlAction.perform", () => {
  test("refuses input that names no source or lacks a hide reason, changing nothing", async () => {
    const apply = mock(dependencies().apply);
    const deps = dependencies({ apply });
    for (const input of [
      { kind: "pause", source: "nope" },
      { kind: "hide", source: "pyp", reason: "   " },
      { kind: "explode", source: "pyp" },
      "pause pyp",
    ]) {
      const result = await SourceControlAction.perform(
        deps,
        "owner",
        input,
        now,
      );
      expect(result.status).toBe("invalid");
    }
    expect(apply).not.toHaveBeenCalled();
  });

  test("hides with a trimmed reason, records who did it and expires the cached list", async () => {
    const apply = mock(dependencies().apply);
    const expireHiddenSources = mock(() => undefined);
    const result = await SourceControlAction.perform(
      dependencies({ apply, expireHiddenSources }),
      "owner",
      { kind: "hide", source: "pratt", reason: "  Site redirects to spam " },
      now,
    );
    expect(apply).toHaveBeenCalledWith({
      source: "pratt",
      change: { kind: "hide", reason: "Site redirects to spam" },
      userId: "owner",
      now,
    });
    expect(expireHiddenSources).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "done" });
    expect(result.message).toContain("15 minutes");
  });

  test("pausing does not touch the hidden list", async () => {
    const expireHiddenSources = mock(() => undefined);
    const result = await SourceControlAction.perform(
      dependencies({ expireHiddenSources }),
      "owner",
      { kind: "pause", source: "pratt" },
      now,
    );
    expect(result.status).toBe("done");
    expect(expireHiddenSources).not.toHaveBeenCalled();
  });

  test("says so when nothing changed", async () => {
    const result = await SourceControlAction.perform(
      dependencies(),
      "owner",
      { kind: "show", source: "pyp" },
      now,
    );
    expect(result).toMatchObject({ status: "unchanged" });
  });

  test("a resumed source still paused by its flag says so", async () => {
    const result = await SourceControlAction.perform(
      dependencies({
        apply: async ({ source }) => ({
          status: "changed",
          control: SourceControl.initial(source),
        }),
        pauseCause: async () => "flag",
      }),
      "owner",
      { kind: "resume", source: "pratt" },
      now,
    );
    expect(result.status).toBe("done");
    expect(result.message).toContain("Vercel flag");
  });

  test("runs now and logs the run ids", async () => {
    const logRun = mock(async () => undefined);
    const result = await SourceControlAction.perform(
      dependencies({ logRun }),
      "owner",
      { kind: "run", source: "pyp" },
      now,
    );
    expect(result).toMatchObject({ status: "done" });
    expect(result.message).toContain("run-1");
    expect(logRun).toHaveBeenCalledWith({
      source: "pyp",
      userId: "owner",
      runId: "run-1",
      workflowRunId: "wrun-1",
      now,
    });
  });

  test("reports a busy source plainly and logs nothing", async () => {
    const logRun = mock(async () => undefined);
    const result = await SourceControlAction.perform(
      dependencies({
        startRun: async (source) => ({ status: "busy", source }),
        logRun,
      }),
      "owner",
      { kind: "run", source: "pyp" },
      now,
    );
    expect(result).toMatchObject({ status: "refused" });
    expect(result.message).toContain("already has a run in progress");
    expect(logRun).not.toHaveBeenCalled();
  });

  test("a failure becomes a plain result that says nothing changed", async () => {
    const result = await SourceControlAction.perform(
      dependencies({
        apply: async () => {
          throw new Error("SQLITE_BUSY: database is locked");
        },
      }),
      "owner",
      { kind: "pause", source: "pyp" },
      now,
    );
    expect(result).toEqual({
      status: "failed",
      message:
        "Could not pause LKQ Pick Your Part. Nothing was changed. Try again in a minute; if it keeps failing, the details below say why.",
      detail: "SQLITE_BUSY: database is locked",
    });
  });

  test("a saved hide whose cache expiry failed says it was saved and may lag", async () => {
    const result = await SourceControlAction.perform(
      dependencies({
        expireHiddenSources: () => {
          throw new Error("updateTag failed");
        },
      }),
      "owner",
      { kind: "hide", source: "pratt", reason: "Hacked" },
      now,
    );
    expect(result.status).toBe("done");
    expect(result.message).toContain("is hidden; that is saved");
    expect(result.message).toContain("up to a day");
    expect(result.message).not.toContain("Nothing was changed");
  });

  test("repeating a hide or show expires the cached list again", async () => {
    const expireHiddenSources = mock(() => undefined);
    const result = await SourceControlAction.perform(
      dependencies({ expireHiddenSources }),
      "owner",
      { kind: "show", source: "pyp" },
      now,
    );
    expect(result.status).toBe("unchanged");
    expect(expireHiddenSources).toHaveBeenCalledTimes(1);
  });

  test("a started run whose log entry failed still reports the run", async () => {
    const result = await SourceControlAction.perform(
      dependencies({
        logRun: async () => {
          throw new Error("log write failed");
        },
      }),
      "owner",
      { kind: "run", source: "pyp" },
      now,
    );
    expect(result.status).toBe("done");
    expect(result.message).toContain("run-1");
    expect(result.message).toContain("not added to the recent actions");
  });
});

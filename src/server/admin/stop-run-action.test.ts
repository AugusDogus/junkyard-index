import { describe, expect, mock, test } from "bun:test";
import {
  StopRunAction,
  type StopRunActionDependencies,
  type StopRunRecord,
} from "./stop-run-action";

const now = new Date("2026-11-23T23:00:00Z");

const crawling: StopRunRecord = {
  runId: "run-1",
  source: "hollanderstores",
  status: "running",
  stage: "sources",
};
const reconciling: StopRunRecord = { ...crawling, stage: "reconcile_upsert" };

function dependencies(
  run: StopRunRecord | null,
  overrides: Partial<StopRunActionDependencies> = {},
): StopRunActionDependencies {
  return {
    readRun: async () => run,
    abandon: async ({ runId }) => ({
      status: "abandoned",
      abandoned: { runId, workflowRunId: "wrun-1" },
      workflowCancellation: "cancelled",
      rebuildCleanup: "done",
    }),
    logStop: async () => undefined,
    startRun: async (source) => ({
      status: "started",
      source,
      runId: "run-2",
      workflowRunId: "wrun-2",
      via: "workflow",
    }),
    logRun: async () => undefined,
    ...overrides,
  };
}

function perform(deps: StopRunActionDependencies, input: unknown) {
  return StopRunAction.perform(deps, "owner", input, now);
}

describe("StopRunAction.perform", () => {
  test("refuses input without a run id or a force answer, stopping nothing", async () => {
    const abandon = mock(dependencies(crawling).abandon);
    for (const input of [
      { kind: "stop", runId: " ", force: false },
      { kind: "stop", runId: "run-1" },
      { kind: "explode", runId: "run-1", force: true },
      "run-1",
    ]) {
      expect(
        (await perform(dependencies(crawling, { abandon }), input)).status,
      ).toBe("invalid");
    }
    expect(abandon).not.toHaveBeenCalled();
  });

  test("a missing or finished run is left alone", async () => {
    const abandon = mock(dependencies(crawling).abandon);
    const missing = await perform(dependencies(null, { abandon }), {
      kind: "stop",
      runId: "run-1",
      force: false,
    });
    expect(missing.status).toBe("refused");
    expect(missing.message).toContain("No ingestion run run-1 exists");
    const ended = await perform(
      dependencies({ ...crawling, status: "success" }, { abandon }),
      { kind: "stop", runId: "run-1", force: false },
    );
    expect(ended).toEqual({
      status: "unchanged",
      message:
        "Hollander Stores's run run-1 already ended (success), so nothing was stopped.",
    });
    expect(abandon).not.toHaveBeenCalled();
  });

  test("a crawling run stops without force or a search rebuild, and is logged", async () => {
    const abandon = mock(dependencies(crawling).abandon);
    const logStop = mock(dependencies(crawling).logStop);
    const result = await perform(dependencies(crawling, { abandon, logStop }), {
      kind: "stop",
      runId: "run-1",
      force: false,
    });
    expect(abandon).toHaveBeenCalledWith({ runId: "run-1", force: false });
    expect(logStop).toHaveBeenCalledWith({
      source: "hollanderstores",
      userId: "owner",
      runId: "run-1",
      workflowRunId: "wrun-1",
      stage: "sources",
      fullRebuild: false,
      now,
    });
    expect(result).toEqual({
      status: "done",
      message:
        "Stopped Hollander Stores's run run-1. Its workflow was cancelled, and runs queued behind it can go ahead. Vehicles it already published stay. Its next scheduled retry is started by today's ingestion pass, which runs the code that pass started on and may be this same old code. Use Run now to restart it on current code.",
    });
  });

  test("a run past its crawl needs force, and then says search rebuilds", async () => {
    const abandon = mock(dependencies(reconciling).abandon);
    const logStop = mock(dependencies(reconciling).logStop);
    const unforced = await perform(
      dependencies(reconciling, { abandon, logStop }),
      { kind: "stop", runId: "run-1", force: false },
    );
    expect(unforced.status).toBe("refused");
    expect(unforced.message).toBe(
      "Hollander Stores's run run-1 is at the reconcile_upsert stage, so stopping it means a full search rebuild. Nothing was stopped. Reload the page and confirm the rebuild to stop it.",
    );
    expect(abandon).not.toHaveBeenCalled();

    const forced = await perform(
      dependencies(reconciling, { abandon, logStop }),
      { kind: "stop", runId: "run-1", force: true },
    );
    expect(abandon).toHaveBeenCalledWith({ runId: "run-1", force: true });
    expect(logStop).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "reconcile_upsert", fullRebuild: true }),
    );
    expect(forced.status).toBe("done");
    expect(forced.message).toContain(
      "It had started writing, so a full search rebuild runs next.",
    );
  });

  test("an unconfirmed Algolia move is refused with the repository's message", async () => {
    const abandon = mock(dependencies(crawling).abandon);
    const result = await perform(
      dependencies(
        { ...crawling, stage: "full_reindex_move_pending" },
        { abandon },
      ),
      { kind: "stop", runId: "run-1", force: true },
    );
    expect(result).toEqual({
      status: "refused",
      message:
        "Run run-1 has an unconfirmed Algolia index move and cannot be abandoned. Retry after Algolia publication is confirmed.",
    });
    expect(abandon).not.toHaveBeenCalled();
  });

  test("a run that ended after it was read is reported unchanged and not logged", async () => {
    const logStop = mock(dependencies(crawling).logStop);
    const startRun = mock(dependencies(crawling).startRun);
    for (const kind of ["stop", "stop_and_run"]) {
      const result = await perform(
        dependencies(crawling, {
          abandon: async ({ runId }) => ({
            status: "already_ended",
            runId,
            runStatus: "success",
          }),
          logStop,
          startRun,
        }),
        { kind, runId: "run-1", force: false },
      );
      expect(result).toEqual({
        status: "unchanged",
        message:
          "Hollander Stores's run run-1 already ended (success), so nothing was stopped.",
      });
    }
    expect(logStop).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
  });

  test("a workflow that could not be cancelled is named so it can be cancelled by hand", async () => {
    const result = await perform(
      dependencies(crawling, {
        abandon: async ({ runId }) => ({
          status: "abandoned",
          abandoned: { runId, workflowRunId: "wrun-1" },
          workflowCancellation: "failed",
          rebuildCleanup: "done",
        }),
      }),
      { kind: "stop", runId: "run-1", force: false },
    );
    expect(result.status).toBe("done");
    expect(result.message).toContain(
      "Its workflow wrun-1 could not be cancelled; cancel it in the Vercel dashboard if it still runs. The run is stopped either way",
    );
  });

  test("a workflow that had already finished is not sent for a hand cancel", async () => {
    const result = await perform(
      dependencies(crawling, {
        abandon: async ({ runId }) => ({
          status: "abandoned",
          abandoned: { runId, workflowRunId: "wrun-1" },
          workflowCancellation: "already_finished",
          rebuildCleanup: "done",
        }),
      }),
      { kind: "stop", runId: "run-1", force: false },
    );
    expect(result.status).toBe("done");
    expect(result.message).toContain(
      "Its workflow had already finished, and runs queued behind it can go ahead.",
    );
    expect(result.message).not.toContain("Vercel dashboard");
  });

  test("a stop whose log write failed still reports the stop", async () => {
    const result = await perform(
      dependencies(crawling, {
        logStop: async () => {
          throw new Error("SQLITE_BUSY");
        },
      }),
      { kind: "stop", runId: "run-1", force: false },
    );
    expect(result.status).toBe("done");
    expect(result.message).toContain(
      "It was not added to the recent actions, because writing the log failed.",
    );
  });

  test("a failed abandon reports its error and what to check", async () => {
    const result = await perform(
      dependencies(crawling, {
        abandon: async () => {
          throw new Error(
            "Ingestion run run-1 kept advancing while abandonment was attempted. Retry the request.",
          );
        },
      }),
      { kind: "stop", runId: "run-1", force: false },
    );
    expect(result).toEqual({
      status: "failed",
      message:
        "Could not stop Hollander Stores's run run-1. Reload the page: if it still shows as running, nothing was stopped. Try again in a minute; if it keeps failing, the details below say why.",
      detail:
        "Ingestion run run-1 kept advancing while abandonment was attempted. Retry the request.",
    });
  });

  test("stop and run again starts a fresh run of the same source and logs both", async () => {
    const startRun = mock(dependencies(crawling).startRun);
    const logRun = mock(dependencies(crawling).logRun);
    const result = await perform(dependencies(crawling, { startRun, logRun }), {
      kind: "stop_and_run",
      runId: "run-1",
      force: false,
    });
    expect(startRun).toHaveBeenCalledWith("hollanderstores");
    expect(logRun).toHaveBeenCalledWith({
      source: "hollanderstores",
      userId: "owner",
      runId: "run-2",
      workflowRunId: "wrun-2",
      now,
    });
    expect(result.status).toBe("done");
    expect(result.message).toContain(
      "Started run run-2 on current code. It appears under Recent runs within a minute.",
    );
  });

  test("stop and run again says why no new run started", async () => {
    const result = await perform(
      dependencies(crawling, {
        startRun: async (source) => ({
          status: "paused",
          source,
          cause: "admin",
        }),
      }),
      { kind: "stop_and_run", runId: "run-1", force: false },
    );
    expect(result.status).toBe("done");
    expect(result.message).toContain("Stopped Hollander Stores's run run-1.");
    expect(result.message).toContain(
      "Hollander Stores is paused here, so no run was started.",
    );
  });

  test("stop and run again reports a stop whose new run failed to start", async () => {
    const result = await perform(
      dependencies(crawling, {
        startRun: async () => {
          throw new Error("workflow start failed");
        },
      }),
      { kind: "stop_and_run", runId: "run-1", force: false },
    );
    expect(result).toMatchObject({
      status: "failed",
      detail: "workflow start failed",
    });
    expect(result.message).toContain("Stopped Hollander Stores's run run-1.");
    expect(result.message).toContain("Starting a new run failed.");
  });

  test("a run across every source cannot be run again, so nothing is stopped", async () => {
    const abandon = mock(dependencies(crawling).abandon);
    const result = await perform(
      dependencies({ ...crawling, source: "all" }, { abandon }),
      { kind: "stop_and_run", runId: "run-1", force: false },
    );
    expect(result.status).toBe("refused");
    expect(abandon).not.toHaveBeenCalled();
  });
});

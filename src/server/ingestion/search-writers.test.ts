import { describe, expect, test } from "bun:test";
import { SearchWriters, type LiveWorkflowRun } from "./search-writers";
import {
  createProjectorDatabase,
  insertRunWithChanges,
} from "./search-projector-test-fixtures";

const NOW = new Date("2026-11-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function run(
  workflow: string,
  deploymentId: string,
  runId = `${workflow}-${deploymentId}`,
): LiveWorkflowRun {
  return {
    runId,
    workflowName: workflow,
    status: "running",
    deploymentId,
    createdAt: NOW.toISOString(),
  };
}

describe("search writers", () => {
  test("only the current deployment's runs and the projector leave a single writer", async () => {
    const { client, database } = await createProjectorDatabase();
    try {
      const live = new Map<string, LiveWorkflowRun[]>([
        [
          "workflow//./src/workflows/vehicle-ingestion//vehicleIngestionWorkflow",
          [
            run(
              "workflow//./src/workflows/vehicle-ingestion//vehicleIngestionWorkflow",
              "dpl_new",
            ),
          ],
        ],
        [
          "workflow//./src/workflows/search-projector//searchProjectorWorkflow",
          [
            run(
              "workflow//./src/workflows/search-projector//searchProjectorWorkflow",
              "dpl_old_projector",
            ),
          ],
        ],
      ]);
      const load = () =>
        SearchWriters.load({
          database,
          currentDeploymentId: "dpl_new",
          now: NOW,
          listLiveRuns: async (name) => live.get(name) ?? [],
        });
      const healthy = SearchWriters.evaluate(await load());
      expect(healthy).toMatchObject({
        singleWriter: true,
        problems: [],
      });
      expect(
        healthy.workflows.map((workflow) => [
          workflow.role,
          workflow.fromCurrentDeployment,
        ]),
      ).toEqual([
        ["ingestion-run", true],
        ["search-projector", false],
      ]);

      // A pass from the deployment before the projector still sweeps
      // search inline at its end.
      live.set(
        "workflow//./src/workflows/vehicle-ingestion//vehicleIngestionPassWorkflow",
        [
          run(
            "workflow//./src/workflows/vehicle-ingestion//vehicleIngestionPassWorkflow",
            "dpl_old",
          ),
        ],
      );
      // And a run is still projecting inline.
      await insertRunWithChanges(
        client,
        {
          id: "inline",
          status: "running",
          stage: "project_changes",
          activeSlot: 1,
        },
        [],
      );
      const blocked = SearchWriters.evaluate(await load());
      expect(blocked.singleWriter).toBe(false);
      expect(blocked.inlineWriterRunIds).toEqual(["inline"]);
      expect(blocked.problems).toEqual(
        expect.arrayContaining([
          expect.stringContaining("inline search stage"),
          expect.stringContaining("pinned to another deployment"),
        ]),
      );
    } finally {
      client.close();
    }
  });

  test("flags active runs older than the backend's listing window", async () => {
    const { client, database } = await createProjectorDatabase();
    try {
      await client.execute({
        sql: "insert into ingestion_run (id, source, status, stage, active_slot, started_at, last_progress_at) values ('ancient', 'pyp', 'running', 'sources', 1, ?, ?)",
        args: [NOW.getTime() - 3 * DAY, NOW.getTime()],
      });
      const report = SearchWriters.evaluate(
        await SearchWriters.load({
          database,
          currentDeploymentId: "dpl_new",
          now: NOW,
          listLiveRuns: async () => [],
        }),
      );
      expect(report).toMatchObject({
        singleWriter: false,
        runsOlderThanListing: ["ancient"],
      });
    } finally {
      client.close();
    }
  });

  test("lists live runs one status at a time, across pages, as the Vercel backend requires", async () => {
    const asked: string[] = [];
    const runs = await SearchWriters.listLiveRuns(
      {
        async list(params) {
          if (Array.isArray(params.status)) {
            throw new Error("status does not support an array of statuses");
          }
          asked.push(`${params.status}:${params.pagination.cursor ?? ""}`);
          const page = params.pagination.cursor === undefined ? 0 : 1;
          return {
            data: [
              {
                runId: `${params.status}-${page}`,
                workflowName: params.workflowName,
                status: params.status,
                deploymentId: "dpl_new",
                createdAt: NOW,
              },
            ],
            cursor: page === 0 ? "next" : null,
            hasMore: page === 0,
          };
        },
      },
      "workflow//./src/workflows/search-projector//searchProjectorWorkflow",
    );
    expect(asked).toEqual([
      "pending:",
      "pending:next",
      "running:",
      "running:next",
    ]);
    expect(runs.map((run) => run.runId)).toEqual([
      "pending-0",
      "pending-1",
      "running-0",
      "running-1",
    ]);
  });
});

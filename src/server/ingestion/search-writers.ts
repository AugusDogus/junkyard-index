import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { inlineWriterRuns } from "./search-projector";

/**
 * Workflows that write (or may write) the search index, by their fully
 * qualified workflow ids. Runs stay pinned to the deployment that started
 * them, so a run from a deployment before the search projector still runs
 * the inline writer, whatever the flags say now.
 */
export const SEARCH_WRITER_WORKFLOWS = {
  "workflow//./src/workflows/vehicle-ingestion//vehicleIngestionWorkflow":
    "ingestion-run",
  "workflow//./src/workflows/vehicle-ingestion//vehicleIngestionPassWorkflow":
    "ingestion-pass",
  "workflow//./src/workflows/search-index-migration//searchIndexMigrationWorkflow":
    "search-index-migration",
  "workflow//./src/workflows/search-projector//searchProjectorWorkflow":
    "search-projector",
} as const;

export type SearchWriterRole =
  (typeof SEARCH_WRITER_WORKFLOWS)[keyof typeof SEARCH_WRITER_WORKFLOWS];

/** A pending or running workflow run, as the workflow backend lists it. */
export interface LiveWorkflowRun {
  runId: string;
  workflowName: string;
  status: string;
  deploymentId: string;
  /** ISO time. */
  createdAt: string;
}

export type SearchWritersInputs = {
  /** This deployment (VERCEL_DEPLOYMENT_ID); null outside Vercel. */
  currentDeploymentId: string | null;
  /** Runs in an inline search stage, from the database. */
  inlineWriterRunIds: string[];
  /** Active ingestion runs started before the backend's listing window. */
  runsOlderThanListing: string[];
  runs: Array<LiveWorkflowRun & { role: SearchWriterRole }>;
};

export type SearchWritersReport = {
  /**
   * Whether the search projector would be the only search writer: no run
   * in an inline search stage, and no ingestion, pass or search-index
   * migration workflow left by another deployment. The decoupled flip waits
   * for this.
   */
  singleWriter: boolean;
  currentDeploymentId: string | null;
  inlineWriterRunIds: string[];
  runsOlderThanListing: string[];
  workflows: Array<
    LiveWorkflowRun & { role: SearchWriterRole; fromCurrentDeployment: boolean }
  >;
  problems: string[];
};

/** The part of the workflow backend's run listing the writers check uses. */
export interface WorkflowRunLister {
  list(params: {
    workflowName: string;
    status: "pending" | "running";
    pagination: { limit: number; cursor?: string };
    resolveData: "none";
  }): Promise<{
    data: Array<{
      runId: string;
      workflowName: string;
      status: string;
      deploymentId: string;
      createdAt: Date;
    }>;
    cursor: string | null;
    hasMore: boolean;
  }>;
}

// The Vercel workflow backend accepts one status per listing.
const LIVE_STATUSES = ["pending", "running"] as const;
const PAGE_SIZE = 100;

/** The workflow backend lists about two days of runs. */
export const WORKFLOW_LISTING_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Who writes the search index right now, by deployment: the cutover check
 * before `ingestion-publication-mode` serves `decoupled`.
 */
export const SearchWriters = {
  /** Every pending or running run of a workflow, all pages. */
  async listLiveRuns(
    runs: WorkflowRunLister,
    workflowName: string,
  ): Promise<LiveWorkflowRun[]> {
    const live: LiveWorkflowRun[] = [];
    for (const status of LIVE_STATUSES) {
      let cursor: string | undefined;
      do {
        const page = await runs.list({
          workflowName,
          status,
          pagination: { limit: PAGE_SIZE, cursor },
          resolveData: "none",
        });
        for (const run of page.data) {
          live.push({
            runId: run.runId,
            workflowName: run.workflowName,
            status: run.status,
            deploymentId: run.deploymentId,
            createdAt: run.createdAt.toISOString(),
          });
        }
        cursor = page.hasMore ? (page.cursor ?? undefined) : undefined;
      } while (cursor !== undefined);
    }
    return live;
  },

  async load(params: {
    database: LibSQLDatabase;
    currentDeploymentId: string | null;
    now: Date;
    listLiveRuns(workflowName: string): Promise<LiveWorkflowRun[]>;
  }): Promise<SearchWritersInputs> {
    const inline = await inlineWriterRuns(params.database);
    const old = await params.database.run(sql`
      select id from ingestion_run
      where active_slot = 1
        and started_at < ${params.now.getTime() - WORKFLOW_LISTING_WINDOW_MS}
      order by id
    `);
    const runs: SearchWritersInputs["runs"] = [];
    for (const [workflowName, role] of Object.entries(
      SEARCH_WRITER_WORKFLOWS,
    )) {
      for (const run of await params.listLiveRuns(workflowName)) {
        runs.push({ ...run, role });
      }
    }
    return {
      currentDeploymentId: params.currentDeploymentId,
      inlineWriterRunIds: inline,
      runsOlderThanListing: old.rows.map((row) => String(row.id)),
      runs,
    };
  },

  evaluate(inputs: SearchWritersInputs): SearchWritersReport {
    const workflows = inputs.runs.map((run) => ({
      ...run,
      fromCurrentDeployment:
        inputs.currentDeploymentId !== null &&
        run.deploymentId === inputs.currentDeploymentId,
    }));
    const problems: string[] = [];
    if (inputs.inlineWriterRunIds.length > 0) {
      problems.push(
        `Runs in an inline search stage still write search: ${inputs.inlineWriterRunIds.join(", ")}. Let them finish (a decoupled deployment hands them to the projector at their next step) or abandon them.`,
      );
    }
    const stale = workflows.filter(
      (run) => run.role !== "search-projector" && !run.fromCurrentDeployment,
    );
    if (stale.length > 0) {
      problems.push(
        `${stale.length} ingestion or search-index migration workflow run(s) are pinned to another deployment, whose code may write search inline: ${stale.map((run) => `${run.runId} (${run.role}, ${run.deploymentId})`).join(", ")}. Wait for them to end, or cancel them (they resume on this deployment from their database state).`,
      );
    }
    if (inputs.runsOlderThanListing.length > 0) {
      problems.push(
        `Active ingestion runs started more than two days ago cannot be listed by deployment and may be pinned to an old one: ${inputs.runsOlderThanListing.join(", ")}. Check their workflows by id before the flip.`,
      );
    }
    if (inputs.currentDeploymentId === null) {
      problems.push(
        "This process has no VERCEL_DEPLOYMENT_ID, so no run can be matched to it; run the check on the deployment that will serve the flip.",
      );
    }
    return {
      singleWriter: problems.length === 0,
      currentDeploymentId: inputs.currentDeploymentId,
      inlineWriterRunIds: inputs.inlineWriterRunIds,
      runsOlderThanListing: inputs.runsOlderThanListing,
      workflows,
      problems,
    };
  },
} as const;

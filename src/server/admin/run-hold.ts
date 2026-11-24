import {
  INGESTION_SOURCE_DISPLAY_NAMES,
  isIngestionSource,
  type IngestionSource,
} from "~/lib/ingestion-source";
import type { ActiveRun } from "./source-overview";

/**
 * A run holding the shared commit (publish slot) for longer than this needs
 * attention. A healthy commit takes minutes; on Nov 23 a run on an old
 * deployment held it for over 12 hours while 17 others waited.
 */
export const LONG_COMMIT_HOLD_MS = 60 * 60 * 1000;

/**
 * Which deployment each live ingestion workflow runs on, from the workflow
 * backend's listing, and the deployment serving this page.
 */
export type WorkflowDeployments =
  | {
      status: "read";
      current: string;
      /** Deployment id by workflow run id, for pending and running runs. */
      byWorkflowRun: ReadonlyMap<string, string>;
    }
  | { status: "unavailable"; message: string };

/**
 * Whether a run executes the current deployment's code. Workflow runs keep
 * the deployment they started on. Unknown: no listing, no attached
 * workflow, or a workflow the listing does not show (ended, or older than
 * its two-day window).
 */
export type RunDeployment =
  | { kind: "current" }
  | { kind: "other"; deploymentId: string }
  | { kind: "unknown" };

/** Staged runs waiting for the commit, and when the first one queued. */
export type CommitQueue =
  | { status: "empty" }
  | { status: "waiting"; runs: number; since: Date; waitedMs: number };

/**
 * The other active runs not known to run the current deployment's code.
 * After a forced stop, the first of them to claim the commit performs the
 * full search rebuild with its own, possibly older, code.
 */
export type OtherCodeRuns = {
  /** Runs on another deployment. */
  other: number;
  /** Their deployment ids, each once. */
  deploymentIds: string[];
  /** Runs whose deployment could not be read. */
  unknown: number;
};

/** One active run, with what it holds and the code it runs. */
export type ActiveRunHold = {
  run: ActiveRun;
  name: string;
  /** Null for a run across every source (a local `runIngestion`). */
  source: IngestionSource | null;
  deployment: RunDeployment;
  /** Every other active run off the current deployment's code. */
  otherCode: OtherCodeRuns;
  /** Set only on the run that holds the shared commit. */
  commit: {
    since: Date;
    heldMs: number;
    /** Held for longer than LONG_COMMIT_HOLD_MS. */
    long: boolean;
    queue: CommitQueue;
  } | null;
};

/** What the stop control needs to name and stop a run. */
export type StoppableRun = {
  runId: string;
  name: string;
  source: IngestionSource | null;
  stage: string;
  /** Today's retries run the pass's code, so an old run's may too. */
  deployment: RunDeployment;
  /** Whoever performs a forced stop's full rebuild may run this code. */
  otherCode: OtherCodeRuns;
};

/** A run problem for the overview's Needs attention list. */
export type RunAttentionItem = {
  title: string;
  detail: string;
  href: string;
  /** Each run the item is about, with a stop control. */
  runs: StoppableRun[];
};

const MINUTE = 60 * 1000;

function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / MINUTE));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Validated runs queue at ready_at; earlier code left it null. */
function queuedAt(run: ActiveRun): Date {
  return run.readyAt ?? run.lastProgressAt;
}

function queueOf(now: Date, runs: readonly ActiveRun[]): CommitQueue {
  const waiting = runs.filter(
    (run) => run.commitStartedAt === null && run.stage !== "sources",
  );
  let since: Date | null = null;
  for (const run of waiting) {
    const at = queuedAt(run);
    if (since === null || at < since) since = at;
  }
  return since === null
    ? { status: "empty" }
    : {
        status: "waiting",
        runs: waiting.length,
        since,
        waitedMs: now.getTime() - since.getTime(),
      };
}

function deploymentOf(
  run: ActiveRun,
  deployments: WorkflowDeployments,
): RunDeployment {
  if (deployments.status === "unavailable" || run.workflowRunId === null) {
    return { kind: "unknown" };
  }
  const deploymentId = deployments.byWorkflowRun.get(run.workflowRunId);
  if (deploymentId === undefined) return { kind: "unknown" };
  return deploymentId === deployments.current
    ? { kind: "current" }
    : { kind: "other", deploymentId };
}

function stoppable(hold: ActiveRunHold): StoppableRun {
  return {
    runId: hold.run.runId,
    name: hold.name,
    source: hold.source,
    stage: hold.run.stage,
    deployment: hold.deployment,
    otherCode: hold.otherCode,
  };
}

function otherCodeOf(
  runId: string,
  deployments: ReadonlyMap<string, RunDeployment>,
): OtherCodeRuns {
  const ids = new Set<string>();
  let other = 0;
  let unknown = 0;
  for (const [id, deployment] of deployments) {
    if (id === runId) continue;
    switch (deployment.kind) {
      case "other":
        other += 1;
        ids.add(deployment.deploymentId);
        break;
      case "unknown":
        unknown += 1;
        break;
      case "current":
        break;
    }
  }
  return { other, deploymentIds: [...ids].sort(), unknown };
}

/** A run's source page, or the overview for a run across every source. */
function sourceHref(source: IngestionSource | null): string {
  return source === null ? "/admin" : `/admin/sources/${source}`;
}

function queueSentence(queue: CommitQueue): string {
  if (queue.status === "empty") return "No other run is waiting for it yet.";
  const runs =
    queue.runs === 1
      ? "1 run has finished crawling and is"
      : `${queue.runs} runs have finished crawling and are`;
  return `${runs} waiting behind it, the first for ${duration(queue.waitedMs)}; each also keeps its source from starting a new run.`;
}

function deploymentClause(deployment: RunDeployment): string {
  switch (deployment.kind) {
    case "other":
      return ` and runs code from another deployment (${deployment.deploymentId}), not the current one, so fixes deployed since it started do not reach it`;
    case "current":
      return " and runs the current deployment's code";
    case "unknown":
      return "";
  }
}

/** Resolves "timeout" after `ms`, unless `work` settles first. */
async function withTimeout<Value>(
  work: Promise<Value>,
  ms: number,
): Promise<Value | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export const RunHold = {
  stoppable,

  /**
   * Which deployment each live ingestion workflow runs on. Lists only when
   * one of `runs` has a workflow attached, and gives up after `timeoutMs` so
   * a slow workflow backend cannot stall the page. Any failure leaves every
   * run's code unknown.
   */
  async readDeployments(params: {
    /** VERCEL_DEPLOYMENT_ID of the process serving the page. */
    current: string | undefined;
    /** The runs whose deployment the page shows. */
    runs: readonly ActiveRun[];
    listLiveRuns: () => Promise<
      readonly { runId: string; deploymentId: string }[]
    >;
    timeoutMs: number;
  }): Promise<WorkflowDeployments> {
    const { current } = params;
    if (!current) {
      return {
        status: "unavailable",
        message:
          "This process has no VERCEL_DEPLOYMENT_ID (it is not running on Vercel), so no run can be matched to the current deployment.",
      };
    }
    if (params.runs.every((run) => run.workflowRunId === null)) {
      return { status: "read", current, byWorkflowRun: new Map() };
    }
    try {
      const live = await withTimeout(params.listLiveRuns(), params.timeoutMs);
      if (live === "timeout") {
        const message = `The workflow backend did not list live ingestion workflows within ${params.timeoutMs / 1000} s, so every run's code version shows as unknown.`;
        console.error(`Admin dashboard: ${message}`);
        return { status: "unavailable", message };
      }
      return {
        status: "read",
        current,
        byWorkflowRun: new Map(
          live.map((run) => [run.runId, run.deploymentId]),
        ),
      };
    } catch (error) {
      console.error(
        "Admin dashboard could not list live ingestion workflows, so every run's deployment shows as unknown",
        error,
      );
      return {
        status: "unavailable",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /** One entry per active run, in the order given. */
  assess(input: {
    now: Date;
    activeRuns: readonly ActiveRun[];
    deployments: WorkflowDeployments;
  }): ActiveRunHold[] {
    const queue = queueOf(input.now, input.activeRuns);
    const deployments = new Map(
      input.activeRuns.map((run) => [
        run.runId,
        deploymentOf(run, input.deployments),
      ]),
    );
    return input.activeRuns.map((run) => {
      const source = isIngestionSource(run.source) ? run.source : null;
      const since = run.commitStartedAt;
      const heldMs = since === null ? 0 : input.now.getTime() - since.getTime();
      return {
        run,
        name:
          source === null
            ? "Every source"
            : INGESTION_SOURCE_DISPLAY_NAMES[source],
        source,
        deployment: deploymentOf(run, input.deployments),
        otherCode: otherCodeOf(run.runId, deployments),
        commit:
          since === null
            ? null
            : {
                since,
                heldMs,
                long: heldMs > LONG_COMMIT_HOLD_MS,
                queue,
              },
      };
    });
  },

  /**
   * A long commit hold, one item per holder (at most one), then every other
   * run on another deployment, grouped into one item.
   */
  attention(holds: readonly ActiveRunHold[]): RunAttentionItem[] {
    const items: RunAttentionItem[] = [];
    for (const hold of holds) {
      if (hold.commit === null || !hold.commit.long) continue;
      items.push({
        title: `${hold.name}'s run has held the publish slot for ${duration(hold.commit.heldMs)}`,
        detail: `Only one run publishes at a time. ${queueSentence(hold.commit.queue)} It is at the ${hold.run.stage} stage${deploymentClause(hold.deployment)}.`,
        href: sourceHref(hold.source),
        runs: [stoppable(hold)],
      });
    }
    const listed = new Set(
      items.flatMap((item) => item.runs.map((run) => run.runId)),
    );
    const others = holds
      .filter(
        (hold) =>
          hold.deployment.kind === "other" && !listed.has(hold.run.runId),
      )
      .map(stoppable)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (others.length > 0) {
      items.push({
        title:
          others.length === 1
            ? "1 run runs code from another deployment"
            : `${others.length} runs run code from another deployment`,
        detail:
          "Workflow runs keep the code they started on, so fixes deployed since do not reach them. Most finish on their own. Stop one that is stuck or holding others up; Stop and run again restarts it on current code.",
        href: sourceHref(others[0]?.source ?? null),
        runs: others,
      });
    }
    return items;
  },
} as const;

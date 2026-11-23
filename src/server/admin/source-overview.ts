import { HiddenSources } from "~/lib/hidden-source";
import {
  INGESTION_SOURCE_DISPLAY_NAMES,
  INGESTION_SOURCES,
  isRetiredIngestionSource,
  type IngestionSource,
} from "~/lib/ingestion-source";
import { isFreshPublication } from "~/server/ingestion/durable-health";
import { IngestionDay } from "~/server/ingestion/ingestion-day";
import { SourceRun, type RunOutcome } from "./source-run";

/**
 * An active run with no recorded progress for this long is stuck. A source
 * waiting on a shared host fails on its own after 3 hours without a chunk
 * advancing (DEFERRED_SOURCE_LIMIT_MS), so longer means nothing is driving it.
 */
export const STUCK_AFTER_MS = 3 * 60 * 60 * 1000;

/** An ingestion run that still holds its source's active slot. */
export type ActiveRun = {
  runId: string;
  source: string;
  stage: string;
  startedAt: Date;
  lastProgressAt: Date;
};

/** The ingestion-source-<source> Vercel flags, read once for every source. */
export type SourceFlagsReading =
  | { status: "read"; enabled: ReadonlySet<string> }
  | { status: "unavailable"; message: string };

/** Off pauses new runs; unknown: the flags could not be read (runs go on). */
export type IngestionFlag = "on" | "off" | "unknown";

/**
 * One state per source, the first that applies in this order: retired,
 * paused by its flag, running, failing (its latest finished run did not
 * publish), stale (no accepted publication within SOURCE_STALE_AFTER_HOURS,
 * the rule /api/status uses), accepted today, else waiting for today's
 * update.
 */
export type SourceState =
  | "retired"
  | "paused"
  | "running"
  | "failing"
  | "stale"
  | "accepted_today"
  | "waiting";

export const SOURCE_STATES: readonly SourceState[] = [
  "failing",
  "stale",
  "running",
  "paused",
  "waiting",
  "accepted_today",
  "retired",
];

export type SourceSummary = {
  source: IngestionSource;
  name: string;
  state: SourceState;
  retired: boolean;
  /** Why the source is hidden from the public site, or null while shown. */
  hiddenReason: string | null;
  flag: IngestionFlag;
  latestRun: { run: SourceRun; outcome: RunOutcome } | null;
  /** Finished runs since the last accepted one, within the loaded window. */
  consecutiveFailures: number;
  /** Null when no accepted run falls in the loaded window. */
  lastAcceptedAt: Date | null;
  /**
   * Expected to publish (not retired or paused) but not accepted within
   * SOURCE_STALE_AFTER_HOURS. A running or failing source can be stale too.
   */
  stale: boolean;
  /** Vehicles on the site now, from yard_inventory; null without any. */
  publishedVehicles: number | null;
  /** Unique vehicles of the last accepted run minus the one before it. */
  vehicleChange: number | null;
  stuck: { runId: string; stage: string; lastProgressAt: Date } | null;
};

export type SourceOverviewInput = {
  now: Date;
  /** Recent runs of every source, in any order. */
  runs: readonly SourceRun[];
  activeRuns: readonly ActiveRun[];
  /** Published vehicles per source. */
  publishedCounts: ReadonlyMap<string, number>;
  flags: SourceFlagsReading;
};

function flagFor(source: IngestionSource, flags: SourceFlagsReading) {
  if (flags.status === "unavailable") return "unknown";
  return flags.enabled.has(source) ? "on" : "off";
}

function summarize(
  source: IngestionSource,
  runs: readonly SourceRun[],
  input: SourceOverviewInput,
): SourceSummary {
  const newestFirst = runs
    .map((run) => ({ run, outcome: SourceRun.outcome(run) }))
    .sort((a, b) => b.run.startedAt.getTime() - a.run.startedAt.getTime());
  const accepted = newestFirst.flatMap(({ run, outcome }) =>
    outcome.kind === "accepted"
      ? [{ run, publishedAt: outcome.publishedAt }]
      : [],
  );
  let consecutiveFailures = 0;
  for (const { outcome } of newestFirst) {
    if (outcome.kind === "accepted") break;
    if (outcome.kind === "rejected") consecutiveFailures += 1;
  }
  const active = input.activeRuns.find((run) => run.source === source);
  const stuck =
    active !== undefined &&
    input.now.getTime() - active.lastProgressAt.getTime() > STUCK_AFTER_MS
      ? {
          runId: active.runId,
          stage: active.stage,
          lastProgressAt: active.lastProgressAt,
        }
      : null;
  const latestRun = newestFirst[0] ?? null;
  const lastAcceptedAt = accepted[0]?.publishedAt ?? null;
  const [newest, previous] = accepted;
  const retired = isRetiredIngestionSource(source);
  const flag = flagFor(source, input.flags);
  const stale =
    !retired &&
    flag !== "off" &&
    !isFreshPublication(lastAcceptedAt?.getTime() ?? null, input.now);
  const state: SourceState = retired
    ? "retired"
    : flag === "off"
      ? "paused"
      : active !== undefined || latestRun?.outcome.kind === "running"
        ? "running"
        : consecutiveFailures > 0
          ? "failing"
          : stale
            ? "stale"
            : lastAcceptedAt !== null &&
                lastAcceptedAt >= IngestionDay.start(input.now)
              ? "accepted_today"
              : "waiting";
  return {
    source,
    name: INGESTION_SOURCE_DISPLAY_NAMES[source],
    state,
    retired,
    hiddenReason: HiddenSources.reason(source) ?? null,
    flag,
    latestRun,
    consecutiveFailures,
    lastAcceptedAt,
    stale,
    publishedVehicles: input.publishedCounts.get(source) ?? null,
    vehicleChange:
      newest === undefined || previous === undefined
        ? null
        : newest.run.uniqueVehicles - previous.run.uniqueVehicles,
    stuck,
  };
}

// A stuck run blocks its source's next run, so it sorts above every state.
function compare(a: SourceSummary, b: SourceSummary): number {
  return (
    Number(b.stuck !== null) - Number(a.stuck !== null) ||
    SOURCE_STATES.indexOf(a.state) - SOURCE_STATES.indexOf(b.state) ||
    b.consecutiveFailures - a.consecutiveFailures ||
    a.name.localeCompare(b.name)
  );
}

/** Every ingestion source's current state, built from bounded reads. */
export const SourceOverview = {
  /** One summary per ingestion source, problems first. */
  build(input: SourceOverviewInput): SourceSummary[] {
    const bySource = new Map<string, SourceRun[]>();
    for (const run of input.runs) {
      const runs = bySource.get(run.source) ?? [];
      runs.push(run);
      bySource.set(run.source, runs);
    }
    return INGESTION_SOURCES.map((source) =>
      summarize(source, bySource.get(source) ?? [], input),
    ).sort(compare);
  },

  counts(summaries: readonly SourceSummary[]): {
    byState: Record<SourceState, number>;
    hidden: number;
  } {
    const byState: Record<SourceState, number> = {
      failing: 0,
      stale: 0,
      running: 0,
      paused: 0,
      waiting: 0,
      accepted_today: 0,
      retired: 0,
    };
    for (const summary of summaries) byState[summary.state] += 1;
    return {
      byState,
      hidden: summaries.filter((summary) => summary.hiddenReason !== null)
        .length,
    };
  },

  /** When the newest loaded run started; null without runs. */
  lastRunStartedAt(runs: readonly SourceRun[]): Date | null {
    let newest: Date | null = null;
    for (const run of runs) {
      if (newest === null || run.startedAt > newest) newest = run.startedAt;
    }
    return newest;
  },
} as const;

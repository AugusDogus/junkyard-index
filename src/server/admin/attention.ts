import { SOURCE_STALE_AFTER_HOURS } from "~/server/ingestion/durable-health";
import type { SourceSummary } from "./source-overview";
import {
  NO_SOURCE_RUN_ERRORS,
  SourceRun,
  type SourceRunErrors,
} from "./source-run";

/**
 * A source must fail this many runs in a row to need attention, unless it
 * is already stale.
 */
export const ATTENTION_FAILURES = 2;

const HOUR = 60 * 60 * 1000;

/** One problem for the overview, in plain words, with the raw text if any. */
export type AttentionItem = {
  title: string;
  detail: string;
  raw: string | null;
  href: string;
};

export type AttentionInput = {
  now: Date;
  sources: readonly SourceSummary[];
  /** Error excerpts of each source's latest run, by source run id. */
  latestErrors: ReadonlyMap<string, SourceRunErrors>;
  /** From SearchOverview: empty while search is keeping up. */
  searchProblems: readonly string[];
  /** From AlertStatus.evaluate: empty while alerts are healthy or paused. */
  alertProblems: readonly string[];
  /** Runs the overview already lists with a stop (RunHold.attention). */
  listedRunIds: ReadonlySet<string>;
};

/** Whether the overview leaves the source out entirely. */
function isQuiet(summary: SourceSummary): boolean {
  return summary.retired || summary.pausedBy !== null;
}

/** Whether the overview lists the source as failing or out of date. */
function listsFailure(summary: SourceSummary): boolean {
  if (isQuiet(summary)) return false;
  return summary.stale || summary.consecutiveFailures >= ATTENTION_FAILURES;
}

function sourceItems(
  summary: SourceSummary,
  input: AttentionInput,
): AttentionItem[] {
  if (isQuiet(summary)) return [];
  const href = `/admin/sources/${summary.source}`;
  const items: AttentionItem[] = [];
  if (summary.stuck !== null && !input.listedRunIds.has(summary.stuck.runId)) {
    const hours = Math.floor(
      (input.now.getTime() - summary.stuck.lastProgressAt.getTime()) / HOUR,
    );
    items.push({
      title: `${summary.name}'s run has made no progress for ${hours} hours`,
      detail: `It is stuck at the ${summary.stuck.stage} stage. Run ${summary.stuck.runId} still holds the source, so no new run of it can start.`,
      raw: null,
      href,
    });
  }
  if (!listsFailure(summary)) return items;
  const failures = summary.consecutiveFailures;
  const latest = summary.latestRun;
  const errors =
    latest === null
      ? NO_SOURCE_RUN_ERRORS
      : (input.latestErrors.get(latest.run.id) ?? NO_SOURCE_RUN_ERRORS);
  const messages = SourceRun.messages(errors);
  items.push({
    title: summary.stale
      ? `${summary.name} has not been updated for over ${SOURCE_STALE_AFTER_HOURS} hours${failureNote(failures)}`
      : `${summary.name} failed its last ${failures} runs`,
    detail: latestDetail(latest, errors),
    raw: messages.length === 0 ? null : messages.join("\n"),
    href,
  });
  return items;
}

function failureNote(failures: number): string {
  if (failures === 0) return "";
  if (failures === 1) return " (its last run failed)";
  return ` (failed its last ${failures} runs)`;
}

function latestDetail(
  latest: SourceSummary["latestRun"],
  errors: SourceRunErrors,
): string {
  if (latest?.outcome.kind === "rejected") {
    return SourceRun.rejectionSummary(latest.outcome, errors);
  }
  if (latest?.outcome.kind === "running") return "A new run is in progress.";
  return "No run of it has been accepted since, so its vehicles on the site may be out of date.";
}

/** The short "needs attention" list on the admin overview. */
export const Attention = {
  /**
   * The latest runs whose error text a page shows: rejected ones (the
   * sources table) and those of sources the overview lists as failing or
   * out of date. Only these runs' error text is read.
   */
  runsShowingErrors(summaries: readonly SourceSummary[]): SourceRun[] {
    return summaries.flatMap((summary) => {
      const latest = summary.latestRun;
      return latest !== null &&
        (latest.outcome.kind === "rejected" || listsFailure(summary))
        ? [latest.run]
        : [];
    });
  },

  collect(input: AttentionInput): AttentionItem[] {
    const items = input.sources.flatMap((summary) =>
      sourceItems(summary, input),
    );
    if (input.searchProblems.length > 0) {
      items.push({
        title: "Search is behind or blocked",
        detail: "Newly found vehicles may be missing from search results.",
        raw: input.searchProblems.join("\n"),
        href: "/admin/search",
      });
    }
    if (input.alertProblems.length > 0) {
      items.push({
        title: "Saved-search alerts are behind",
        detail:
          "Subscribers may not be getting their alert emails or messages.",
        raw: input.alertProblems.join("\n"),
        href: "/admin/search",
      });
    }
    return items;
  },
} as const;

import type { SourceSummary } from "./source-overview";
import { SourceRun, type SourceRunErrors } from "./source-run";

/** A source must fail this many runs in a row to need attention. */
export const ATTENTION_FAILURES = 2;

const HOUR = 60 * 60 * 1000;
const NO_ERRORS: SourceRunErrors = { errors: null, validationErrors: null };

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
};

function sourceItems(
  summary: SourceSummary,
  input: AttentionInput,
): AttentionItem[] {
  if (summary.retired || summary.flag === "off") return [];
  const href = `/admin/sources/${summary.source}`;
  const items: AttentionItem[] = [];
  if (summary.stuck !== null) {
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
  const latest = summary.latestRun;
  if (summary.consecutiveFailures >= ATTENTION_FAILURES && latest !== null) {
    const errors = input.latestErrors.get(latest.run.id) ?? NO_ERRORS;
    const messages = SourceRun.messages(errors);
    items.push({
      title: `${summary.name} failed its last ${summary.consecutiveFailures} runs`,
      detail:
        latest.outcome.kind === "rejected"
          ? SourceRun.rejectionSummary(latest.outcome, errors)
          : "A new run is in progress.",
      raw: messages.length === 0 ? null : messages.join("\n"),
      href,
    });
  }
  return items;
}

/** The short "needs attention" list on the admin overview. */
export const Attention = {
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

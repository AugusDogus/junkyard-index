import type { ConsumerMode } from "~/server/ingestion/consumer-flags";
import {
  SEARCH_LAG_THRESHOLD_MS,
  type SearchStatus,
} from "~/server/ingestion/search-status";
import type { UnprocessedChanges } from "./search-repository";

/**
 * Changes waiting for search. Inline: source runs publish their own changes
 * and delete them once searchable, so unprocessed outbox rows are the
 * backlog. Decoupled: the projector's checkpoint trails the outbox horizon.
 */
export type SearchBacklog =
  | ({ kind: "inline" } & UnprocessedChanges)
  | { kind: "decoupled"; count: number; lagMs: number };

export type SearchOverview = {
  /** The existing /api/status/search evaluation. */
  status: SearchStatus;
  /** The consumer-search-projector flag. */
  projector: ConsumerMode;
  newestSearchPublishedAt: Date | null;
  backlog: SearchBacklog;
  fullReindexRequired: boolean;
  /** Raw problem descriptions; empty while search keeps up. */
  problems: string[];
};

export const SearchOverview = {
  build(params: {
    now: Date;
    status: SearchStatus;
    projector: ConsumerMode;
    newestSearchPublishedAt: Date | null;
    unprocessed: UnprocessedChanges;
    fullReindexRequired: boolean;
  }): SearchOverview {
    const { status, unprocessed } = params;
    const backlog: SearchBacklog =
      status.status === "inline"
        ? { kind: "inline", ...unprocessed }
        : { kind: "decoupled", count: status.lagChanges, lagMs: status.lagMs };
    const problems = status.status === "unhealthy" ? [...status.problems] : [];
    if (
      backlog.kind === "inline" &&
      backlog.oldestCreatedAt !== null &&
      params.now.getTime() - backlog.oldestCreatedAt.getTime() >
        SEARCH_LAG_THRESHOLD_MS
    ) {
      problems.push(
        `${backlog.count}${backlog.capped ? "+" : ""} vehicle changes have waited for search since ${backlog.oldestCreatedAt.toISOString()}, over the ${SEARCH_LAG_THRESHOLD_MS / 60_000} minute threshold.`,
      );
    }
    if (params.fullReindexRequired) {
      problems.push(
        "An ingestion run has full_reindex_required set: search owes a full rebuild, and alert checks wait for it.",
      );
    }
    return {
      status,
      projector: params.projector,
      newestSearchPublishedAt: params.newestSearchPublishedAt,
      backlog,
      fullReindexRequired: params.fullReindexRequired,
      problems,
    };
  },
} as const;

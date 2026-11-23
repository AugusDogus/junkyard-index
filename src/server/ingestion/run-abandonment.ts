/**
 * Whether an active run may be abandoned now. A run still crawling
 * (`sources`) has written nothing shared, so it stops cleanly. Past that,
 * reconciliation may have written part of its inventory, so abandoning it
 * needs force and makes the next run rebuild search in full. An unconfirmed
 * Algolia index move is never abandoned: it must finish or be confirmed.
 */
export type RunAbandonmentCheck =
  | { status: "allowed"; fullRebuild: boolean }
  | { status: "force_required"; message: string }
  | { status: "move_pending"; message: string };

export const RunAbandonment = {
  check(params: {
    runId: string;
    stage: string;
    force: boolean;
  }): RunAbandonmentCheck {
    const { runId, stage, force } = params;
    if (stage === "full_reindex_move_pending") {
      return {
        status: "move_pending",
        message: `Run ${runId} has an unconfirmed Algolia index move and cannot be abandoned. Retry after Algolia publication is confirmed.`,
      };
    }
    const fullRebuild = stage !== "sources";
    if (fullRebuild && !force) {
      return {
        status: "force_required",
        message: `Run ${runId} entered ${stage}; force is required and will mandate a full Algolia rebuild.`,
      };
    }
    return { status: "allowed", fullRebuild };
  },
} as const;

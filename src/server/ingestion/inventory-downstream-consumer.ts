// Orchestration only: the workflow passes its steps in, so this module stays
// free of database and network imports and can run in the workflow bundle.

/** Whether the inventory-downstream consumer has work now. */
export type InventoryDownstreamDue =
  | { status: "paused" }
  /** The consumer already finished the latest publication. */
  | { status: "current"; refreshedThrough: number }
  /** A newer publication waits for the refresh interval. */
  | {
      status: "recent";
      publicationSequence: number;
      refreshedThrough: number;
      /** ISO time; step results stay plain data. */
      nextRefreshAt: string;
    }
  | {
      status: "due";
      publicationSequence: number;
      refreshedThrough: number;
      /** ISO time the tick checked; the checkpoint records it on success. */
      checkedAt: string;
    };

/** How IndexNow answered: skipped means there was nothing to send. */
export type AnnouncementStatus = "submitted" | "skipped" | "failed";

/** Storing the homepage snapshot or revalidating the caches failed. */
export type InventoryRefreshFailure = {
  status: "failed";
  stage: "project" | "revalidate";
  message: string;
};

export type InventoryDownstreamResult =
  | Exclude<InventoryDownstreamDue, { status: "due" }>
  | {
      status: "refresh_failed";
      publicationSequence: number;
      stage: InventoryRefreshFailure["stage"];
      message: string;
    }
  | {
      status: "refreshed";
      publicationSequence: number;
      /** Changed pages warmed and offered to IndexNow. */
      pagesChanged: number;
      /** IndexNow's answer; failed also covers warming or submitting throwing. */
      announcement: AnnouncementStatus;
    };

/**
 * One inventory-downstream tick: when a Turso publication is newer than the
 * consumer's checkpoint and the last refresh is old enough, it stores the
 * homepage snapshot and revalidates the inventory caches, then requests the
 * changed pages and announces them to IndexNow, then advances the checkpoint.
 * A failed refresh leaves the checkpoint behind, so the next tick retries.
 * The announcement is best effort, as it was at the end of a pass: IndexNow
 * keeps its own checkpoint, so a failed one is retried with the next
 * publication's. Nothing here reads or writes search.
 */
export async function runInventoryDownstream(operations: {
  due(): Promise<InventoryDownstreamDue>;
  /** Snapshot plus revalidateTag, each only when behind. */
  refresh(): Promise<{ status: "ok" } | InventoryRefreshFailure>;
  /** Requests the pages changed since the last announcement; returns them. */
  warm(publicationSequence: number): Promise<string[]>;
  /** Gives requested pages time to regenerate before crawlers hear of them. */
  waitForPages(): Promise<void>;
  announce(
    publicationSequence: number,
    paths: string[],
  ): Promise<AnnouncementStatus>;
  /**
   * Advances the checkpoint, stamped with the tick's check time rather than
   * its end, so the 3-hour gate does not drift by each tick's runtime.
   */
  record(publicationSequence: number, checkedAt: string): Promise<void>;
}): Promise<InventoryDownstreamResult> {
  // Invoke step callbacks without serializing the operations object as `this`.
  const { due, refresh, warm, waitForPages, announce, record } = operations;
  const state = await due();
  if (state.status !== "due") return state;
  const { publicationSequence } = state;
  const refreshed = await refresh();
  if (refreshed.status === "failed") {
    return {
      status: "refresh_failed",
      publicationSequence,
      stage: refreshed.stage,
      message: refreshed.message,
    };
  }
  let announcement: AnnouncementStatus;
  let pagesChanged = 0;
  try {
    const paths = await warm(publicationSequence);
    pagesChanged = paths.length;
    if (paths.length === 0) {
      announcement = "skipped";
    } else {
      await waitForPages();
      announcement = await announce(publicationSequence, paths);
    }
  } catch (error) {
    console.error(
      `[Workflow] Could not announce publication ${publicationSequence}'s changed inventory pages to IndexNow; the IndexNow checkpoint stays behind, so the next publication's announcement retries them: ${error instanceof Error ? error.message : String(error)}`,
    );
    announcement = "failed";
  }
  await record(publicationSequence, state.checkedAt);
  return {
    status: "refreshed",
    publicationSequence,
    pagesChanged,
    announcement,
  };
}

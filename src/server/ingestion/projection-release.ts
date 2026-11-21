import { and, eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun } from "~/schema";
import { releasedRunValues } from "./durable-algolia-publish";

/** Where a projection batch finds its run's search publication. */
export type ProjectionRelease =
  | { status: "stopped" }
  | { status: "complete"; searchPublishedAt: Date }
  | SearchProjectorHandoff;

/**
 * A run already released by its final projection batch. Publication
 * releases the run, so a retried final batch (its write landed, its response
 * did not) finds it here and completes instead of stopping. A run released
 * without a search publication was handed to the search projector.
 */
export function releasedProjection(run: {
  status: string;
  stage: string;
  searchPublishedAt: Date | null;
}): ProjectionRelease | null {
  if (run.status !== "success" || run.stage !== "released") return null;
  if (run.searchPublishedAt === null) {
    return { status: "complete", releasedTo: "search_projector" };
  }
  return { status: "complete", searchPublishedAt: run.searchPublishedAt };
}

/**
 * Releases a run whose changes are all projected: its inventory is
 * searchable, so it frees the shared commit. Alerts are checked daily apart.
 */
export async function releaseProjectedRun(params: {
  database: LibSQLDatabase;
  runId: string;
  projectorCursor: number;
  now: Date;
}): Promise<ProjectionRelease> {
  const released = await params.database
    .update(ingestionRun)
    .set(releasedRunValues(params.now))
    .where(
      and(
        eq(ingestionRun.id, params.runId),
        eq(ingestionRun.status, "running"),
        eq(ingestionRun.activeSlot, 1),
        eq(ingestionRun.stage, "project_changes"),
        eq(ingestionRun.projectorCursor, params.projectorCursor),
      ),
    );
  if (released.rowsAffected === 0) return { status: "stopped" };
  return { status: "complete", searchPublishedAt: params.now };
}

/**
 * A run the previous release left matching alerts is already searchable.
 * Release it without matching: searches it checked advanced their windows
 * with their intents in one transaction, and the daily alert check covers
 * the rest from their unchanged windows.
 */
export async function releaseLegacyAlertMatchingRun(params: {
  database: LibSQLDatabase;
  runId: string;
  searchPublishedAt: Date | null;
  now: Date;
}): Promise<ProjectionRelease> {
  const searchPublishedAt = params.searchPublishedAt ?? params.now;
  const released = await params.database
    .update(ingestionRun)
    .set({ ...releasedRunValues(params.now), searchPublishedAt })
    .where(
      and(
        eq(ingestionRun.id, params.runId),
        eq(ingestionRun.status, "running"),
        eq(ingestionRun.activeSlot, 1),
        eq(ingestionRun.stage, "match_alerts"),
      ),
    );
  if (released.rowsAffected === 0) return { status: "stopped" };
  return { status: "complete", searchPublishedAt };
}

/** A run handed to the search projector without projecting its changes. */
export type SearchProjectorHandoff = {
  status: "complete";
  releasedTo: "search_projector";
};

/**
 * Inline search stages a run can leave without writing search. A pending
 * index move is not among them: its move may be in flight, so the run
 * finishes it inline, and the search projector waits for it.
 */
const HANDOFF_STAGES = [
  "project_changes",
  "full_reindex_prepare",
  "full_reindex_load",
  "full_reindex_publish",
  "full_reindex_publish_failed",
] as const;

/**
 * Once publication is decoupled, a run still in an inline search stage
 * releases the shared commit without calling search: the search projector
 * publishes its remaining `vehicle_change_v2` rows from the outbox, and a
 * rebuild it carries stays recorded in `full_reindex_required` until the
 * projector's own rebuild covers it. Returns null when the run is not in such
 * a stage (released, stopped, or moving an index).
 */
export async function releaseToSearchProjector(params: {
  database: LibSQLDatabase;
  runId: string;
  now: Date;
}): Promise<SearchProjectorHandoff | null> {
  const released = await params.database
    .update(ingestionRun)
    .set({
      status: "success",
      stage: "released",
      activeSlot: null,
      releasedAt: params.now,
      completedAt: params.now,
      lastProgressAt: params.now,
    })
    .where(
      and(
        eq(ingestionRun.id, params.runId),
        eq(ingestionRun.status, "running"),
        eq(ingestionRun.activeSlot, 1),
        inArray(ingestionRun.stage, [...HANDOFF_STAGES]),
      ),
    );
  if (released.rowsAffected === 0) return null;
  return { status: "complete", releasedTo: "search_projector" };
}

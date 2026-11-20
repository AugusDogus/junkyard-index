import { and, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun } from "~/schema";
import { releasedRunValues } from "./durable-algolia-publish";

/** Where a projection batch finds its run's search publication. */
export type ProjectionRelease =
  | { status: "stopped" }
  | { status: "complete"; searchPublishedAt: Date };

/**
 * A run already released by its final projection batch. Publication
 * releases the run, so a retried final batch (its write landed, its response
 * did not) finds it here and completes instead of stopping.
 */
export function releasedProjection(run: {
  status: string;
  stage: string;
  searchPublishedAt: Date | null;
}): ProjectionRelease | null {
  if (run.status !== "success" || run.stage !== "released") return null;
  return {
    status: "complete",
    searchPublishedAt: run.searchPublishedAt ?? new Date(),
  };
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

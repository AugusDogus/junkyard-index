import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionProjectorCheckpoint } from "~/schema";

// Holds the highest publication sequence whose changes were announced.
const CHECKPOINT_NAME = "indexnow-announcement";

// Without a checkpoint, the publications of about the last day count as new.
const FIRST_WINDOW_MS = 26 * 60 * 60 * 1000;

// However long announcements failed, look back no further than this.
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The commit times of the publications not yet announced. Ingestion stamps a
 * run's arrivals (first_seen_at) and removals (missing_since_at) with its
 * commit time, so these bound every change those publications made.
 */
export type AnnouncementWindow = { since: Date; until: Date };

export const InventoryAnnouncement = {
  /**
   * The window of publications after the last announced one, through
   * `publicationSequence`, or null when there are none.
   */
  async window(
    database: LibSQLDatabase,
    publicationSequence: number,
    now: Date,
  ): Promise<AnnouncementWindow | null> {
    const result = await database.all<{
      since: number | null;
      until: number | null;
    }>(sql`
      select
        min(coalesce(commit_started_at, started_at)) as since,
        max(coalesce(commit_started_at, started_at)) as until
      from ingestion_run
      where publication_sequence <= ${publicationSequence}
        and publication_sequence > coalesce(
          (
            select last_processed_change_id
            from ingestion_projector_checkpoint
            where name = ${CHECKPOINT_NAME}
          ),
          (
            select coalesce(max(publication_sequence), 0)
            from ingestion_run
            where inventory_published_at < ${now.getTime() - FIRST_WINDOW_MS}
          )
        )
    `);
    const [row] = result;
    if (!row || row.since === null || row.until === null) return null;
    return {
      since: new Date(Math.max(row.since, now.getTime() - MAX_WINDOW_MS)),
      until: new Date(row.until),
    };
  },

  /** Records that changes through this publication were announced; never moves backward. */
  async record(
    database: LibSQLDatabase,
    publicationSequence: number,
  ): Promise<void> {
    const updatedAt = new Date();
    await database
      .insert(ingestionProjectorCheckpoint)
      .values({
        name: CHECKPOINT_NAME,
        lastProcessedChangeId: publicationSequence,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: ingestionProjectorCheckpoint.name,
        set: { lastProcessedChangeId: publicationSequence, updatedAt },
        setWhere: sql`${ingestionProjectorCheckpoint.lastProcessedChangeId} < ${publicationSequence}`,
      });
  },
} as const;

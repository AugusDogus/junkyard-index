import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionProjectorCheckpoint } from "~/schema";

// Holds the highest publication sequence whose changes were announced.
const CHECKPOINT_NAME = "indexnow-announcement";

// The first announcement covers the publications of about the last day.
const FIRST_WINDOW_MS = 26 * 60 * 60 * 1000;

// However long announcements failed, look back no further than this.
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The changes not yet announced, by the time ingestion stamped them. A run
 * stamps its arrivals (first_seen_at) and removals (missing_since_at) with its
 * commit time, and commits run one at a time, so the changes after the last
 * announced run's commit, through the newest one being announced, include
 * those of runs that never published.
 */
export type AnnouncementWindow = { after: Date; until: Date };

export const InventoryAnnouncement = {
  /**
   * The changes after the last announced publication, through
   * `publicationSequence`, or null when it is already announced. The first
   * call records a starting checkpoint about a day back, so a failed first
   * announcement is retried like any other.
   */
  async window(
    database: LibSQLDatabase,
    publicationSequence: number,
    now: Date,
  ): Promise<AnnouncementWindow | null> {
    await database.run(sql`
      insert into ingestion_projector_checkpoint (name, last_processed_change_id, updated_at)
      select ${CHECKPOINT_NAME}, coalesce(max(publication_sequence), 0), ${now.getTime()}
      from ingestion_run
      where inventory_published_at < ${now.getTime() - FIRST_WINDOW_MS}
      on conflict do nothing
    `);
    const [row] = await database.all<{
      after: number | null;
      until: number | null;
    }>(sql`
      with checkpoint as (
        select last_processed_change_id as announced
        from ingestion_projector_checkpoint
        where name = ${CHECKPOINT_NAME}
      )
      select
        (
          select max(coalesce(commit_started_at, started_at))
          from ingestion_run
          where publication_sequence <= (select announced from checkpoint)
        ) as after,
        (
          select max(coalesce(commit_started_at, started_at))
          from ingestion_run
          where publication_sequence <= ${publicationSequence}
            and publication_sequence > (select announced from checkpoint)
        ) as until
    `);
    if (!row || row.until === null) return null;
    return {
      after: new Date(Math.max(row.after ?? 0, now.getTime() - MAX_WINDOW_MS)),
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

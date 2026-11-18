import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

export const INGESTION_RUN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const RUN_BATCH_SIZE = 100;
const MAX_BATCHES_PER_PASS = 10;

/**
 * A single statement rechecks every reference under SQLite's write lock. Foreign
 * keys cascade all six child tables. Snapshot cleanup owns Blob deletion first.
 * Old failed URG attempts since its last publication remain heartbeat evidence.
 */
export async function pruneIngestionRuns(params: {
  database: LibSQLDatabase;
  now?: Date;
}): Promise<void> {
  const cutoff = new Date(
    (params.now ?? new Date()).getTime() - INGESTION_RUN_RETENTION_MS,
  );
  for (let batch = 1; batch <= MAX_BATCHES_PER_PASS; batch += 1) {
    try {
      const result = await params.database.run(sql`
        with accepted as (
          select s.run_id, s.status as source_status, r.search_published_at,
            rank() over (partition by s.source order by s.started_at desc) as accepted_rank,
            rank() over (partition by s.source order by r.search_published_at desc) as published_rank,
            rank() over (partition by s.source, s.status order by r.search_published_at desc) as cursor_rank
          from ingestion_source_run s join ingestion_run r on r.id = s.run_id
          where s.acceptance_status = 'accepted'
        ), published as (
          select id, rank() over (
            partition by source order by search_published_at desc
          ) as published_rank
          from ingestion_run where search_published_at is not null
        ), inventory_published as (
          select id, rank() over (
            partition by source order by inventory_published_at desc
          ) as published_rank
          from ingestion_run where inventory_published_at is not null
        )
        delete from ingestion_run where id in (
          select r.id from ingestion_run r
          where r.active_slot is null and r.completed_at < ${cutoff.getTime()}
            and r.last_progress_at < ${cutoff.getTime()}
            and (r.released_at is null or r.released_at < ${cutoff.getTime()})
            and r.status in ('success', 'error', 'abandoned')
            and (r.status != 'success' or r.stage = 'released')
            and r.stage != 'full_reindex_move_pending'
            and r.full_reindex_required = 0
            and r.id not in (
              select run_id from accepted
              where accepted_rank = 1 or (published_rank = 1 and search_published_at is not null)
                or (cursor_rank = 1 and source_status = 'success' and search_published_at is not null)
            )
            and r.id not in (select id from published where published_rank = 1)
            and r.id not in (select id from inventory_published where published_rank = 1)
            and (r.publication_sequence is null or r.publication_sequence < (
              select max(publication_sequence) from ingestion_run
            ))
            and not exists (
              select 1 from ingestion_source_run s where s.run_id = r.id
                and (s.status = 'running' or s.snapshot_chunks != '[]'
                  or (s.source = 'urgiis' and s.started_at >= (
                    select coalesce(max(p.search_published_at), 0)
                    from ingestion_run p join ingestion_source_run ps on ps.run_id = p.id
                    where ps.source = 'urgiis' and ps.status = 'success'
                      and ps.acceptance_status = 'accepted'
                  )))
            )
            and not exists (
              select 1 from search_notification_intent i where i.run_id = r.id
                and (i.status not in ('delivered', 'cancelled') or i.claim_token is not null)
            )
            and not exists (
              select 1 from vehicle_change_v2 c where c.run_id = r.id and c.processed_at is null
            )
          order by r.completed_at, r.id limit ${RUN_BATCH_SIZE}
        )
      `);
      if (result.rowsAffected < RUN_BATCH_SIZE) return;
    } catch (error) {
      console.error("Ingestion run pruning failed; retrying next pass", {
        operation: "prune_ingestion_runs",
        cutoff: cutoff.toISOString(),
        batch,
        batchSize: RUN_BATCH_SIZE,
        error,
      });
      return;
    }
  }
}

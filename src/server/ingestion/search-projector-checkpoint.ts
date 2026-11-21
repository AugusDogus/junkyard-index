import type { InStatement } from "@libsql/client";
import { eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { AlgoliaErrorTag } from "~/lib/algolia-failure-tag";
import { ingestionProjectorCheckpoint } from "~/schema";
import { SearchOutbox } from "./search-outbox";

const CHECKPOINT_NAME = SearchOutbox.checkpointName;
const MINUTE_MS = 60 * 1000;

/**
 * Failures that say the search backend rejects every write until someone
 * acts (a block, a used-up quota, or a rejection the projector could not
 * pin to single records). They open the circuit for longer, and the
 * projector probes the backend before it writes again.
 */
const BLOCKING_TAGS: ReadonlySet<AlgoliaErrorTag> = new Set([
  "SearchBackendBlocked",
  "QuotaExceeded",
  "InvalidRequest",
]);

const BLOCKING_BACKOFF = { baseMs: 15 * MINUTE_MS, maxMs: 6 * 60 * MINUTE_MS };
const TRANSIENT_BACKOFF = { baseMs: MINUTE_MS, maxMs: 60 * MINUTE_MS };

function isAlgoliaErrorTag(value: string | null): value is AlgoliaErrorTag {
  return (
    value === "SearchBackendBlocked" ||
    value === "QuotaExceeded" ||
    value === "RateLimited" ||
    value === "NotFound" ||
    value === "InvalidRequest" ||
    value === "Transient"
  );
}

/** The search projector's row in `ingestion_projector_checkpoint`. */
export interface SearchProjectorCheckpointState {
  /** The last `vehicle_change_v2` id made searchable. */
  projectedThrough: number;
  /** Consecutive failed attempts since the last success. */
  failureCount: number;
  lastErrorTag: AlgoliaErrorTag | null;
  blockedUntil: Date | null;
  lastSuccessAt: Date | null;
}

/**
 * closed: write. open: wait until `retryAt`. half_open: the wait is over
 * after a blocking failure; probe the backend before writing.
 */
export type SearchProjectorCircuit =
  | { state: "closed" }
  | {
      state: "open";
      tag: AlgoliaErrorTag;
      failureCount: number;
      retryAt: Date;
    }
  | { state: "half_open"; tag: AlgoliaErrorTag; failureCount: number };

/** A recorded failure and when the projector retries. */
export interface SearchProjectorBackoff {
  failureCount: number;
  retryAt: Date;
  /** Whether this failure opened the circuit, rather than kept it open. */
  opened: boolean;
}

/**
 * The search projector's cursor and circuit breaker. The cursor only moves
 * forward, by a compare-and-swap on its previous value, in the same
 * transaction as anything else the batch records. Failures never touch
 * `ingestion_run`: a blocked search backend only delays search.
 */
export const SearchProjectorCheckpoint = {
  name: CHECKPOINT_NAME,

  /** The checkpoint, or its starting state before the projector first ran. */
  async read(
    database: LibSQLDatabase,
  ): Promise<SearchProjectorCheckpointState> {
    const [row] = await database
      .select()
      .from(ingestionProjectorCheckpoint)
      .where(eq(ingestionProjectorCheckpoint.name, CHECKPOINT_NAME))
      .limit(1);
    const lastErrorTag = row?.lastErrorTag ?? null;
    return {
      projectedThrough: row?.lastProcessedChangeId ?? 0,
      failureCount: row?.failureCount ?? 0,
      lastErrorTag: isAlgoliaErrorTag(lastErrorTag) ? lastErrorTag : null,
      blockedUntil: row?.blockedUntil ?? null,
      lastSuccessAt: row?.lastSuccessAt ?? null,
    };
  },

  circuit(
    state: SearchProjectorCheckpointState,
    now: Date,
  ): SearchProjectorCircuit {
    if (state.lastErrorTag === null || state.failureCount === 0) {
      return { state: "closed" };
    }
    if (state.blockedUntil !== null && now < state.blockedUntil) {
      return {
        state: "open",
        tag: state.lastErrorTag,
        failureCount: state.failureCount,
        retryAt: state.blockedUntil,
      };
    }
    return BLOCKING_TAGS.has(state.lastErrorTag)
      ? {
          state: "half_open",
          tag: state.lastErrorTag,
          failureCount: state.failureCount,
        }
      : { state: "closed" };
  },

  /** Whether a failure blocks every write until someone acts. */
  isBlocking(tag: AlgoliaErrorTag): boolean {
    return BLOCKING_TAGS.has(tag);
  },

  /** How long the projector waits after its `failureCount`th failure in a row. */
  backoffMs(tag: AlgoliaErrorTag, failureCount: number): number {
    const { baseMs, maxMs } = BLOCKING_TAGS.has(tag)
      ? BLOCKING_BACKOFF
      : TRANSIENT_BACKOFF;
    return Math.min(maxMs, baseMs * 2 ** Math.max(0, failureCount - 1));
  },

  /** Creates the row at change 0 unless it exists. */
  async ensure(database: LibSQLDatabase, now: Date): Promise<void> {
    await database
      .insert(ingestionProjectorCheckpoint)
      .values({
        name: CHECKPOINT_NAME,
        kind: "outbox",
        lastProcessedChangeId: 0,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: ingestionProjectorCheckpoint.name });
  },

  /**
   * Moves the cursor from `from` to `to` and closes the circuit. It applies
   * only while the cursor is still at `from`, so of two projectors only the
   * first advances; the caller checks `rowsAffected`. Run `ensure` first.
   */
  advanceStatement(params: {
    from: number;
    to: number;
    now: Date;
  }): InStatement {
    const now = params.now.getTime();
    return {
      sql: `
        update ingestion_projector_checkpoint
        set last_processed_change_id = ?, failure_count = 0,
            last_error_tag = null, blocked_until = null,
            last_success_at = ?, updated_at = ?
        where name = ? and last_processed_change_id = ?
      `,
      args: [params.to, now, now, CHECKPOINT_NAME, params.from],
    };
  },

  /**
   * Clears `full_reindex_required` on finished runs the index now covers:
   * runs with no change above `through`, the checkpoint the same batch
   * advanced to. Skipped, abandoned and handed-off runs keep the flag until
   * then, and the saved-search alert bound waits on it. The projector only
   * runs with a live generation, which was built from the whole `vehicle`
   * table, so a flag a run merely inherited is settled too.
   */
  clearSettledRebuildsStatement(through: number): InStatement {
    return {
      sql: `
        update ingestion_run
        set full_reindex_required = 0
        where full_reindex_required = 1
          and active_slot is null
          and not exists (
            select 1 from vehicle_change_v2 outbox_change
            where outbox_change.run_id = ingestion_run.id
              and outbox_change.id > ?
          )
          and exists (
            select 1 from ingestion_projector_checkpoint
            where name = ? and last_processed_change_id = ?
          )
      `,
      args: [through, CHECKPOINT_NAME, through],
    };
  },

  /**
   * Records a failed attempt without moving the cursor, and blocks the
   * projector until a backoff passes: from 15 minutes doubling to 6 hours
   * for blocking failures, from 1 minute to 1 hour otherwise. The projector
   * is a singleton, so reading and then writing the count cannot interleave.
   */
  async recordFailure(
    database: LibSQLDatabase,
    failure: { tag: AlgoliaErrorTag; now: Date },
  ): Promise<SearchProjectorBackoff> {
    const state = await SearchProjectorCheckpoint.read(database);
    const failureCount = state.failureCount + 1;
    const retryAt = new Date(
      failure.now.getTime() +
        SearchProjectorCheckpoint.backoffMs(failure.tag, failureCount),
    );
    const failed = {
      failureCount,
      lastErrorTag: failure.tag,
      blockedUntil: retryAt,
      updatedAt: failure.now,
    };
    await database
      .insert(ingestionProjectorCheckpoint)
      .values({
        name: CHECKPOINT_NAME,
        kind: "outbox",
        lastProcessedChangeId: 0,
        ...failed,
      })
      .onConflictDoUpdate({
        target: ingestionProjectorCheckpoint.name,
        set: failed,
      });
    return {
      failureCount,
      retryAt,
      opened: state.failureCount === 0 || state.lastErrorTag !== failure.tag,
    };
  },

  /** Closes the circuit after a successful probe or a step with no work. */
  async recordSuccess(database: LibSQLDatabase, now: Date): Promise<void> {
    await database
      .update(ingestionProjectorCheckpoint)
      .set({
        failureCount: 0,
        lastErrorTag: null,
        blockedUntil: null,
        lastSuccessAt: now,
        updatedAt: now,
      })
      .where(sql`${ingestionProjectorCheckpoint.name} = ${CHECKPOINT_NAME}`);
  },
} as const;

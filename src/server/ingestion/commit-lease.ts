import type { InStatement, InValue } from "@libsql/client";

/**
 * The shared reconciliation commit, held through `ingestion_run`:
 * `commit_started_at` is set on the one active run that holds it, and
 * validated runs wait with `commit_started_at` null.
 *
 * - Order: waiters claim first-in, first-out by `ready_at`, the time
 *   validation staged them (ties by run id). Source priority decides VIN
 *   ownership during reconciliation, never queue order.
 * - Liveness: every claim attempt records `last_progress_at`, and waiters
 *   retry at least every 5 minutes. A waiter silent for 15 minutes (its
 *   workflow died) is skipped, so a dead head of the queue blocks nobody. It
 *   keeps its place and claims when a resumed workflow retries.
 * - Spacing: a claim is stamped in a later whole second than every earlier
 *   holder's stamp, every saved search's `last_checked_at` and every daily
 *   alert check's `checked_through` (search-alert-check.ts). Vehicles carry
 *   the stamp as `firstSeenAt`, which search compares in whole seconds, so
 *   commits stay disjoint, and a commit never lands inside an alert window
 *   that is already fixed. The claim never waits for spacing.
 * - Expiry: every claim attempt and every pass wakeup releases waiters whose
 *   staged snapshot is older than 24 hours. Their accepted sources become
 *   `expired` and nothing is reconciled, so the prior inventory stays live
 *   and each source re-crawls within its daily attempts. Wakeups enforce it
 *   too, so it holds when no waiter runs this code (every waiter's workflow
 *   died, or was pinned to a deployment from before this lease).
 * - Supersession: each pass wakeup releases waiters from an earlier
 *   ingestion day the same way, so a snapshot stuck behind a long commit
 *   never holds its source's slot into the next day; that day's crawl
 *   replaces it.
 * - A released waiter never held the commit, so any search rebuild it
 *   carries was inherited at start and still sits on the finished run it came
 *   from. Release clears it, or a release during a rebuild would order
 *   another one.
 *
 * Workflows pinned to deployments from before this lease still run the
 * source-priority claim. Both claims are one guarded UPDATE that requires no
 * other active run with `commit_started_at` set, and Turso serializes
 * writes, so exactly one run holds the commit across both versions. Pinned
 * waiters never record progress, so this claim skips them 15 minutes after
 * validation; their own claim still waits for any higher-priority ready run,
 * which bounds a mixed wait to those 15 minutes. Claim attempts here also
 * expire pinned waiters' snapshots once they are 24 hours old. A pinned
 * waiter can still take a free commit out of FIFO order, and can publish a
 * stale snapshot if it claims before any attempt here expires it. Cancel
 * pinned workflows after deploying (the pass restarts their runs on the
 * current deployment) to end the overlap.
 */
const LIVENESS_MS = 15 * 60 * 1000;
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const EXPIRED_SNAPSHOT_ERROR =
  "The staged snapshot expired after waiting more than 24 hours for the commit turn. None of its vehicles were published; the prior inventory stays live, and the source re-crawls within its daily attempts.";
const SUPERSEDED_SNAPSHOT_ERROR =
  "The staged snapshot was superseded: its ingestion day ended while it waited for the commit turn, so the new day's crawl of the source replaces it. None of its vehicles were published; the prior inventory stays live until that crawl publishes.";

/** When a validated run joined the queue. Runs validated by earlier code have no ready_at; their last_progress_at is the validation time. */
function readySql(run: string): string {
  return `coalesce(${run}.ready_at, ${run}.last_progress_at)`;
}

const WAITERS_SQL = `
  select id from ingestion_run
  where active_slot = 1 and status = 'running'
    and commit_started_at is null and stage <> 'sources'
`;
const EXPIRED_WAITERS_SQL = `${WAITERS_SQL} and ${readySql("ingestion_run")} < ?`;
const SUPERSEDED_WAITERS_SQL = `${WAITERS_SQL} and schedule_key < ?`;

/** Releases the waiters `waitersSql` selects with `arg`, recording `error`. */
function releaseWaiterStatements(
  waitersSql: string,
  arg: InValue,
  error: string,
  now: Date,
): InStatement[] {
  return [
    {
      sql: `
        update ingestion_source_run set acceptance_status = 'expired'
        where acceptance_status = 'accepted'
          and run_id in (${waitersSql})
      `,
      args: [arg],
    },
    {
      sql: `
        update ingestion_run
        set status = 'error', stage = 'released', active_slot = null,
            full_reindex_required = 0,
            errors = json_insert(coalesce(errors, '[]'), '$[#]', ?),
            completed_at = ?, released_at = ?
        where id in (${waitersSql})
      `,
      args: [error, now.getTime(), now.getTime(), arg],
    },
  ];
}

/** Releases waiters whose staged snapshot is older than the TTL. */
function expireStatements(now: Date): InStatement[] {
  return releaseWaiterStatements(
    EXPIRED_WAITERS_SQL,
    now.getTime() - SNAPSHOT_TTL_MS,
    EXPIRED_SNAPSHOT_ERROR,
    now,
  );
}

/** Releases waiters staged on an ingestion day before `scheduleKey`. */
function supersedeStatements(scheduleKey: string, now: Date): InStatement[] {
  return releaseWaiterStatements(
    SUPERSEDED_WAITERS_SQL,
    scheduleKey,
    SUPERSEDED_SNAPSHOT_ERROR,
    now,
  );
}

/**
 * Claims the commit for `runId` when no other run holds it and no live
 * waiter is ahead of it. A run resuming its own commit keeps its stamp.
 */
function claimStatement(runId: string, now: Date): InStatement {
  return {
    sql: `
      update ingestion_run
      set full_reindex_required = case
            when commit_started_at is null and exists (
              select 1 from ingestion_run finished
              where finished.full_reindex_required = 1
                and finished.active_slot is null
            ) then 1
            else full_reindex_required
          end,
          ready_at = ${readySql("ingestion_run")},
          -- A later whole second than every released holder, every saved
          -- search's check time and every daily alert check's bound, so the
          -- run's vehicles fall after any window already fixed. The holder
          -- itself is active, so only released runs can precede a
          -- successful claim.
          commit_started_at = coalesce(commit_started_at, max(
            ?,
            (select coalesce(max(commit_started_at), 0)
              from ingestion_run where active_slot is null) / 1000 * 1000 + 1000,
            (select coalesce(max(last_checked_at), 0)
              from saved_search) / 1000 * 1000 + 1000,
            (select coalesce(max(checked_through), 0)
              from search_alert_check) / 1000 * 1000 + 1000
          )),
          last_progress_at = ?
      where id = ? and status = 'running' and active_slot = 1
        and not exists (
          select 1 from ingestion_run other
          where other.id <> ? and other.active_slot = 1
            and other.commit_started_at is not null
        )
        and (commit_started_at is not null or not exists (
          select 1 from ingestion_run other
          where other.id <> ? and other.active_slot = 1
            and other.commit_started_at is null
            and other.stage <> 'sources'
            and other.last_progress_at >= ?
            and (${readySql("other")}, other.id)
              < (${readySql("ingestion_run")}, ingestion_run.id)
        ))
    `,
    args: [
      now.getTime(),
      now.getTime(),
      runId,
      runId,
      runId,
      now.getTime() - LIVENESS_MS,
    ],
  };
}

/** Records a busy attempt, so later claims see this waiter as live. */
function waitStatement(runId: string, now: Date): InStatement {
  return {
    sql: `
      update ingestion_run
      set ready_at = ${readySql("ingestion_run")}, last_progress_at = ?
      where id = ? and status = 'running' and active_slot = 1
        and commit_started_at is null
    `,
    args: [now.getTime(), runId],
  };
}

export const CommitLease = {
  livenessMs: LIVENESS_MS,
  snapshotTtlMs: SNAPSHOT_TTL_MS,
  readySql,
  expireStatements,
  supersedeStatements,
  claimStatement,
  waitStatement,
} as const;

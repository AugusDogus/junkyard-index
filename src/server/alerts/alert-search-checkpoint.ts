import type { InStatement, InValue } from "@libsql/client";
import { SearchOutbox } from "~/server/ingestion/search-outbox";

/**
 * When a run's vehicles were stamped: its commit claim, or its start for a
 * local run that never claims.
 */
export const RUN_VEHICLE_STAMP_SQL = (run: string) =>
  `coalesce(${run}.commit_started_at, case when ${run}.source = 'all' then ${run}.started_at end)`;

/**
 * Whether a run's vehicles may be missing from the search index: its commit
 * is still in progress, it was abandoned (or released with search skipped)
 * and awaits a rebuild, or it wrote changes the search projector had not
 * made searchable by change id `through` (an SQL expression or placeholder).
 * Inline runs delete their changes once searchable; runs that keep changes
 * (decoupled, skipped, abandoned or handed off) stay unsearchable until the
 * projector's checkpoint passes them and `full_reindex_required` is clear.
 */
export function runNotSearchableSql(run: string, through: string): string {
  return `(
    ${run}.active_slot = 1
    or ${run}.full_reindex_required = 1
    or ${SearchOutbox.runHasChangesAboveSql(run, through)}
  )`;
}

/**
 * Whether a commit inside the check's window was not yet fully searchable
 * when the batch read Algolia: not searchable as of the projector checkpoint
 * the batch read, or published inline after the read. The check's bound
 * excludes such commits when it is created; this catches one whose claim
 * landed later with an older timestamp. Placeholders: the check id, the
 * read's start and the projector checkpoint it read.
 */
function unsearchableWindowCommitSql(): string {
  return `
    exists (
      select 1 from ingestion_run run, search_alert_check alert_check
      where alert_check.id = ?
        and ${RUN_VEHICLE_STAMP_SQL("run")} <= alert_check.checked_through
        and (
          run.search_published_at >= ?
          or ${runNotSearchableSql("run", "?")}
        )
    )
  `;
}

/**
 * The publication sequence a check's intents carry: the newest one among
 * released runs whose vehicles are in its window. Its one placeholder is the
 * check's `checked_through`. A run outside the window, or still active (an
 * old-release run may yet match alerts under its own sequence), never lends
 * its sequence to vehicles it did not publish. Two windows can still share
 * one, for example when an abandoned run's vehicles reach search through a
 * later rebuild; the checkpoint then defers the search (see below).
 */
export const WINDOW_PUBLICATION_SEQUENCE_SQL = `(
  select coalesce(max(window_run.publication_sequence), 0)
  from ingestion_run window_run
  where window_run.publication_sequence is not null
    and window_run.active_slot is null
    and window_run.full_reindex_required = 0
    and ${RUN_VEHICLE_STAMP_SQL("window_run")} <= ?
)`;

const LEGACY_ALERT_MATCHING_SQL = `
  exists (
    select 1 from ingestion_run
    where active_slot = 1 and stage = 'match_alerts'
  )
`;

/** What an alert check batch read, which its writes are fenced to. */
export interface SearchAlertCheckRead {
  checkId: string;
  expectedCursor: string | null;
  /** When the batch started reading Algolia. */
  readStartedAtMs: number;
  /**
   * The search projector's checkpoint (a `vehicle_change_v2` id) before the
   * batch read Algolia: every change at or below it was searchable.
   */
  projectedThrough: number;
}

/** Why the vehicles a batch read may be incomplete; null when they are not. */
export function searchAlertCheckBlockerQuery(read: SearchAlertCheckRead): {
  sql: string;
  args: InValue[];
} {
  return {
    sql: `
      select case
        when ${LEGACY_ALERT_MATCHING_SQL} then 'legacy_alert_matching'
        when ${unsearchableWindowCommitSql()} then 'unsearchable_commit'
      end as blocker
    `,
    args: [read.checkId, read.readStartedAtMs, read.projectedThrough],
  };
}

/**
 * Fences a saved-search write to the alert check batch that read it: the
 * check is still running at the cursor it read, no ingestion run left by the
 * previous release is matching alerts (its window could overlap), and every
 * commit in the window was searchable when the batch read Algolia.
 */
export function searchAlertCheckWriteGuard(read: SearchAlertCheckRead): {
  sql: string;
  args: InValue[];
} {
  return {
    sql: `
      exists (
        select 1 from search_alert_check
        where id = ? and status = 'running' and search_cursor is ?
      )
      and not ${LEGACY_ALERT_MATCHING_SQL}
      and not ${unsearchableWindowCommitSql()}
    `,
    args: [
      read.checkId,
      read.expectedCursor,
      read.checkId,
      read.readStartedAtMs,
      read.projectedThrough,
    ],
  };
}

/**
 * Advances a saved search's alert window to `checkedThrough`. It applies only
 * while the search still has the match version and window the check read, so
 * an edit or a concurrent check cannot be overwritten. The window never moves
 * backward: a search enabled after the check's bound keeps its newer start.
 *
 * For each channel the check is alerting, another owner's intent with the
 * same sequence would make the new intent a silent no-op on the dedupe
 * index, so the window stays put instead and a later check, with a newer
 * sequence, sends those vehicles.
 */
export function savedSearchAlertCheckpointStatement(params: {
  read: SearchAlertCheckRead;
  searchId: string;
  searchMatchVersion: number;
  expectedLastCheckedAtMs: number | null;
  checkedThroughMs: number;
  alertChannels: readonly ("email" | "discord")[];
  quarantine: { atMs: number; reason: string } | null;
}): InStatement {
  const guard = searchAlertCheckWriteGuard(params.read);
  const conflicts = params.alertChannels.map((channel) => ({
    sql: `
        and not exists (
          select 1 from search_notification_intent other
          where other.saved_search_id = ? and other.channel = ?
            and other.publication_sequence = ${WINDOW_PUBLICATION_SEQUENCE_SQL}
            and (other.alert_check_id is null or other.alert_check_id <> ?)
        )
      `,
    args: [
      params.searchId,
      channel,
      params.checkedThroughMs,
      params.read.checkId,
    ],
  }));
  return {
    sql: `
      update saved_search
      set last_checked_at = max(coalesce(last_checked_at, 0), ?),
          last_matched_publication_sequence = max(
            last_matched_publication_sequence,
            ${WINDOW_PUBLICATION_SEQUENCE_SQL}
          ),
          alert_quarantined_at = ?,
          alert_quarantine_reason = ?,
          updated_at = updated_at
      where id = ? and search_match_version = ? and last_checked_at is ?
        and ${guard.sql}
        ${conflicts.map((conflict) => conflict.sql).join("")}
    `,
    args: [
      params.checkedThroughMs,
      params.checkedThroughMs,
      params.quarantine?.atMs ?? null,
      params.quarantine?.reason ?? null,
      params.searchId,
      params.searchMatchVersion,
      params.expectedLastCheckedAtMs,
      ...guard.args,
      ...conflicts.flatMap((conflict) => conflict.args),
    ],
  };
}

import type { Client } from "@libsql/client";

/** An alert intent that could still be delivered. */
export interface PendingSearchAlertIntent {
  id: string;
  savedSearchId: string;
  channel: string;
  status: string;
  createdAt: number;
}

/**
 * pending_intents: notifications that could still go out (perhaps backlog
 * matches) block the relaunch; nothing changed.
 * resumed: windows advanced, after cancelling pending intents if asked.
 */
export type SearchAlertsResumed =
  | { status: "pending_intents"; intents: PendingSearchAlertIntent[] }
  | {
      status: "resumed";
      /** Alert-enabled searches whose window now starts at the relaunch. */
      advanced: number;
      /** Alert-enabled searches already checked through a later time. */
      alreadyLater: number;
      cancelledIntents: number;
    };

const PENDING_INTENT_SQL = "status in ('pending', 'retry', 'sending')";

/**
 * Restarts every alert-enabled saved search's window at `relaunchAt`, so
 * vehicles first seen while alerts were paused are skipped rather than sent
 * as one backlog. A window already past the relaunch is left alone. It
 * refuses while any notification intent could still be delivered, unless
 * `cancelPending` cancels them in the same transaction, so no backlog match
 * goes out when alerts are switched on. Run it while the
 * `search-alerts-enabled` flag is off (docs/runbooks/resume-search-alerts.md).
 */
export async function resumeSearchAlerts(
  client: Pick<Client, "batch">,
  relaunchAt: Date,
  options: { cancelPending: boolean; now: Date },
): Promise<SearchAlertsResumed> {
  const relaunchMs = relaunchAt.getTime();
  const alertsEnabled =
    "(email_alerts_enabled = 1 or discord_alerts_enabled = 1)";
  // Without cancelling, every write is fenced on there being no pending
  // intent, so the check and the advance are one atomic decision.
  const noPendingIntent = options.cancelPending
    ? "1 = 1"
    : `not exists (select 1 from search_notification_intent where ${PENDING_INTENT_SQL})`;
  const results = await client.batch(
    [
      {
        sql: `select id, saved_search_id, channel, status, created_at
              from search_notification_intent
              where ${PENDING_INTENT_SQL}
              order by created_at, id`,
        args: [],
      },
      {
        sql: `update search_notification_intent
              set status = 'cancelled', cancelled_at = ?, claim_token = null,
                  last_error = 'cancelled_at_search_alert_relaunch'
              where ${PENDING_INTENT_SQL} and ?`,
        args: [options.now.getTime(), Number(options.cancelPending)],
      },
      {
        sql: `select count(*) as n from saved_search
              where ${alertsEnabled} and coalesce(last_checked_at, 0) >= ?`,
        args: [relaunchMs],
      },
      {
        sql: `update saved_search
              set last_checked_at = ?, updated_at = updated_at
              where ${alertsEnabled} and coalesce(last_checked_at, 0) < ?
                and ${noPendingIntent}`,
        args: [relaunchMs, relaunchMs],
      },
    ],
    "write",
  );
  const [pending, cancelled, alreadyLater, advanced] = results;
  if (!pending || !cancelled || !alreadyLater || !advanced) {
    throw new Error(
      "Resuming saved-search alerts returned no result; the transaction did not report its changes. Check saved_search.last_checked_at and search_notification_intent before retrying (the update never moves a window backward, so a retry is safe).",
    );
  }
  if (!options.cancelPending && pending.rows.length > 0) {
    return {
      status: "pending_intents",
      intents: pending.rows.map((row) => ({
        id: String(row.id),
        savedSearchId: String(row.saved_search_id),
        channel: String(row.channel),
        status: String(row.status),
        createdAt: Number(row.created_at),
      })),
    };
  }
  return {
    status: "resumed",
    advanced: advanced.rowsAffected,
    alreadyLater: Number(alreadyLater.rows[0]?.n ?? 0),
    cancelledIntents: cancelled.rowsAffected,
  };
}

export type ResumeSearchAlertsArgs =
  | {
      status: "ok";
      databaseUrl: string;
      relaunchAt: Date;
      cancelPending: boolean;
    }
  | { status: "invalid"; message: string };

const USAGE =
  "Usage: bun scripts/resume-search-alerts.ts --db-url <libsql url> --relaunch-at <ISO time with Z or offset> --confirm [--cancel-pending] (TURSO_AUTH_TOKEN authenticates remote databases)";

// A time without a zone would be read in the operator's local time.
const EXPLICIT_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Parses the script's arguments. It requires an explicit database URL (never
 * one from the environment) and `--confirm`, and refuses a relaunch time in
 * the future: commit claims wait until after the newest window start, so a
 * future time would hold up ingestion.
 */
export function parseResumeSearchAlertsArgs(
  argv: readonly string[],
  now: Date,
): ResumeSearchAlertsArgs {
  let databaseUrl: string | undefined;
  let relaunchAtText: string | undefined;
  let confirmed = false;
  let cancelPending = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--confirm") confirmed = true;
    else if (arg === "--cancel-pending") cancelPending = true;
    else if (arg === "--db-url") databaseUrl = argv[++index];
    else if (arg === "--relaunch-at") relaunchAtText = argv[++index];
    else
      return {
        status: "invalid",
        message: `Unknown argument ${arg}. ${USAGE}`,
      };
  }
  if (!databaseUrl) {
    return {
      status: "invalid",
      message: `Pass the target database explicitly with --db-url; the environment's database is never used. ${USAGE}`,
    };
  }
  if (!relaunchAtText) {
    return {
      status: "invalid",
      message: `Pass --relaunch-at, the time alerts resume from. ${USAGE}`,
    };
  }
  if (!EXPLICIT_ZONE.test(relaunchAtText)) {
    return {
      status: "invalid",
      message: `--relaunch-at ${relaunchAtText} has no time zone; end it with Z or an offset, such as 2026-11-21T06:30:00Z.`,
    };
  }
  const relaunchAt = new Date(relaunchAtText);
  if (Number.isNaN(relaunchAt.getTime())) {
    return {
      status: "invalid",
      message: `--relaunch-at ${relaunchAtText} is not a valid time; use ISO 8601, such as 2026-11-21T18:00:00Z.`,
    };
  }
  if (relaunchAt.getTime() > now.getTime()) {
    return {
      status: "invalid",
      message: `--relaunch-at ${relaunchAt.toISOString()} is in the future. Commit claims wait until after the newest alert window start, so this would hold up ingestion; use the current time or earlier.`,
    };
  }
  if (!confirmed) {
    return {
      status: "invalid",
      message: `This advances every alert-enabled saved search in ${databaseUrl} to ${relaunchAt.toISOString()} and cannot be undone. Rerun with --confirm. ${USAGE}`,
    };
  }
  return { status: "ok", databaseUrl, relaunchAt, cancelPending };
}

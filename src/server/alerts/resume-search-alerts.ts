import type { Client } from "@libsql/client";

export interface SearchAlertsResumed {
  /** Alert-enabled searches whose window now starts at the relaunch. */
  advanced: number;
  /** Alert-enabled searches already checked through a later time. */
  alreadyLater: number;
}

/**
 * Restarts every alert-enabled saved search's window at `relaunchAt`, so
 * vehicles first seen while alerts were paused are skipped rather than sent
 * as one backlog. A window already past the relaunch is left alone. Runs in
 * one transaction while the `search-alerts-enabled` flag is off; switch the
 * flag on afterwards (docs/runbooks/resume-search-alerts.md).
 */
export async function resumeSearchAlerts(
  client: Pick<Client, "batch">,
  relaunchAt: Date,
): Promise<SearchAlertsResumed> {
  const relaunchMs = relaunchAt.getTime();
  const alertsEnabled =
    "(email_alerts_enabled = 1 or discord_alerts_enabled = 1)";
  const [alreadyLater, advanced] = await client.batch(
    [
      {
        sql: `select count(*) as n from saved_search
              where ${alertsEnabled} and coalesce(last_checked_at, 0) >= ?`,
        args: [relaunchMs],
      },
      {
        sql: `update saved_search
              set last_checked_at = ?, updated_at = updated_at
              where ${alertsEnabled} and coalesce(last_checked_at, 0) < ?`,
        args: [relaunchMs, relaunchMs],
      },
    ],
    "write",
  );
  if (!alreadyLater || !advanced) {
    throw new Error(
      "Resuming saved-search alerts returned no result; the transaction did not report its changes. Check saved_search.last_checked_at before retrying (the update never moves a window backward, so a retry is safe).",
    );
  }
  return {
    advanced: advanced.rowsAffected,
    alreadyLater: Number(alreadyLater.rows[0]?.n ?? 0),
  };
}

export type ResumeSearchAlertsArgs =
  | { status: "ok"; databaseUrl: string; relaunchAt: Date }
  | { status: "invalid"; message: string };

const USAGE =
  "Usage: bun scripts/resume-search-alerts.ts --db-url <libsql url> --relaunch-at <ISO time> --confirm (TURSO_AUTH_TOKEN authenticates remote databases)";

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
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--confirm") confirmed = true;
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
  return { status: "ok", databaseUrl, relaunchAt };
}

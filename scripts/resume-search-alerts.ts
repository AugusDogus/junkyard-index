/**
 * Restarts every alert-enabled saved search's alert window at a relaunch
 * time, skipping vehicles first seen while alerts were paused. Run it while
 * the `search-alerts-enabled` flag is off and before search's rebuild
 * publishes, then switch the flag on. It refuses while notifications are
 * pending unless --cancel-pending cancels them. See
 * docs/runbooks/resume-search-alerts.md.
 *
 * Usage:
 *   TURSO_AUTH_TOKEN=... bun scripts/resume-search-alerts.ts \
 *     --db-url libsql://<database> --relaunch-at 2026-11-21T06:30:00Z --confirm \
 *     [--cancel-pending]
 */
import { createClient } from "@libsql/client";
import {
  parseResumeSearchAlertsArgs,
  resumeSearchAlerts,
} from "../src/server/alerts/resume-search-alerts";

async function main(): Promise<number> {
  const args = parseResumeSearchAlertsArgs(process.argv.slice(2), new Date());
  if (args.status === "invalid") {
    console.error(`[resume-search-alerts] ${args.message}`);
    return 1;
  }
  const client = createClient({
    url: args.databaseUrl,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  try {
    const result = await resumeSearchAlerts(client, args.relaunchAt, {
      cancelPending: args.cancelPending,
      now: new Date(),
    });
    if (result.status === "pending_intents") {
      console.error(
        `[resume-search-alerts] Refused: ${result.intents.length} notification intents could still be delivered, and switching alerts on would send them. Nothing changed. Inspect them, then rerun with --cancel-pending to cancel them in the same transaction:`,
      );
      console.table(result.intents);
      return 1;
    }
    console.info(
      `[resume-search-alerts] Alert windows now start at ${args.relaunchAt.toISOString()}: ${result.advanced} saved searches advanced, ${result.alreadyLater} already later and unchanged, ${result.cancelledIntents} pending notification intents cancelled. Switch the search-alerts-enabled flag on once search's rebuild has published.`,
    );
    return 0;
  } finally {
    client.close();
  }
}

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(
        "[resume-search-alerts] Failed; no window moved unless the transaction committed (rerunning is safe, it never moves a window backward):",
        error,
      );
      process.exit(1);
    },
  );
}

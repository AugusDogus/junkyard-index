/**
 * Restarts every alert-enabled saved search's alert window at a relaunch
 * time, skipping vehicles first seen while alerts were paused. Run it while
 * the `search-alerts-enabled` flag is off, then switch the flag on. See
 * docs/runbooks/resume-search-alerts.md.
 *
 * Usage:
 *   TURSO_AUTH_TOKEN=... bun scripts/resume-search-alerts.ts \
 *     --db-url libsql://<database> --relaunch-at 2026-11-21T18:00:00Z --confirm
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
    const result = await resumeSearchAlerts(client, args.relaunchAt);
    console.info(
      `[resume-search-alerts] Alert windows now start at ${args.relaunchAt.toISOString()}: ${result.advanced} saved searches advanced, ${result.alreadyLater} already later and unchanged. Switch the search-alerts-enabled flag on to resume alerts.`,
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

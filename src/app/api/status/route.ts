import { IngestionPause } from "~/server/source-control/ingestion-pause";
import { SourceHealth } from "~/server/ingestion/source-health";
import { YardCheckHealth } from "~/server/ingestion/yard-check-health";
import { cachedTursoUsage } from "~/server/turso-usage-runtime";
import { getCachedSourceFreshness } from "./source-freshness";
import { getCachedYardCheckRows } from "./yard-checks";

// One Better Stack monitor for the ingestion pipeline: 503 once at least a
// fifth of the active, unpaused sources lack an accepted publication within
// 36 hours; 200 otherwise, "degraded" while fewer are stale. Both list the
// stale sources; single providers alert through their own status rows. Paused
// sources (paused from /admin, or their Vercel flag serving false) are
// listed, not checked. If the source_control read fails, it is 503 with a
// body naming that read, since no source can be checked.
//
// `yards` lists yards of unpaused sources with no live fetch in 36 hours
// (notChecked, which makes a healthy status degraded, and unreported) and
// frozen yards (information only). A yard never makes this 503: one large
// multi-yard provider must not read as an ingestion outage. If the yard read
// fails, `yards` says so and the source check still answers.
//
// `databaseUsage` reports the Turso plan pace and the last day's usage (read
// at most hourly, no database rows); it never changes the status code, and
// the hourly database-usage cron raises the Sentry issues.
export async function GET() {
  const [recent, enabled, yardRows, databaseUsage] = await Promise.all([
    getCachedSourceFreshness(),
    IngestionPause.enabledSources().then(
      (sources) => ({ ok: true as const, sources }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    getCachedYardCheckRows().then(
      (rows) => ({ ok: true as const, rows }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    cachedTursoUsage(),
  ]);
  if (!enabled.ok) {
    return Response.json(
      {
        status: "unavailable",
        error:
          "Could not read which sources are paused (the source_control table in the database), so no source was checked. Nothing was changed. Check the database connection and the deploy's logs, then retry.",
        detail:
          enabled.error instanceof Error
            ? enabled.error.message
            : String(enabled.error),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const now = new Date();
  const health = SourceHealth.evaluate(recent, enabled.sources, now);
  const yards = yardRows.ok
    ? {
        status: "ok" as const,
        ...YardCheckHealth.evaluate(yardRows.rows, enabled.sources, now),
      }
    : {
        status: "unavailable" as const,
        error:
          "Could not read per-yard checks (the yard_check and yard_inventory tables), so no yard was checked. Source health above is unaffected. Check the database connection and the deploy's logs, then retry.",
        detail:
          yardRows.error instanceof Error
            ? yardRows.error.message
            : String(yardRows.error),
      };
  const status =
    health.status === "healthy" &&
    yards.status === "ok" &&
    yards.notChecked.length > 0
      ? "degraded"
      : health.status;
  return Response.json(
    { ...health, status, yards, databaseUsage },
    {
      status: status === "stale" ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

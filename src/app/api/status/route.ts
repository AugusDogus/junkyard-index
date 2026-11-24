import { IngestionPause } from "~/server/source-control/ingestion-pause";
import { SourceHealth } from "~/server/ingestion/source-health";
import { getCachedSourceFreshness } from "./source-freshness";

// One Better Stack monitor for the ingestion pipeline: 503 once at least a
// fifth of the active, unpaused sources lack an accepted publication within
// 36 hours; 200 otherwise, "degraded" while fewer are stale. Both list the
// stale sources; single providers alert through their own status rows. Paused
// sources (paused from /admin, or their Vercel flag serving false) are
// listed, not checked. If the source_control read fails, it is 503 with a
// body naming that read, since no source can be checked.
export async function GET() {
  const [recent, enabled] = await Promise.all([
    getCachedSourceFreshness(),
    IngestionPause.enabledSources().then(
      (sources) => ({ ok: true as const, sources }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
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
  const health = SourceHealth.evaluate(recent, enabled.sources, new Date());
  return Response.json(health, {
    status: health.status === "stale" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}

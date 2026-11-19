import { IngestionSourceFlags } from "~/server/ingestion/ingestion-source-flags";
import { SourceHealth } from "~/server/ingestion/source-health";
import { getCachedSourceFreshness } from "./source-freshness";

// One Better Stack monitor for every source: 200 while each active, unpaused
// source has an accepted publication within 36 hours, 503 listing the stale
// ones otherwise. Paused sources (Vercel flag serving false) are listed, not
// checked.
export async function GET() {
  const [recent, enabled] = await Promise.all([
    getCachedSourceFreshness(),
    IngestionSourceFlags.enabledSources(),
  ]);
  const health = SourceHealth.evaluate(recent, enabled, new Date());
  return Response.json(health, {
    status: health.status === "healthy" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

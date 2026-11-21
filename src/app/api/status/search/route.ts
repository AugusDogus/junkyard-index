import { db } from "~/lib/db";
import { AlgoliaDeployment } from "~/lib/algolia-deployment";
import { ConsumerFlags } from "~/server/ingestion/consumer-flags";
import { PublicationModeFlag } from "~/server/ingestion/publication-mode-flag";
import { SearchStatus } from "~/server/ingestion/search-status";

// One Better Stack monitor for search publication: 503 while decoupled
// search lags Turso by over 2 hours, its circuit is open, or no live
// generation describes the index; 200 otherwise, including while the
// projector is paused or source runs publish search inline. Reads Turso
// only, never Algolia.
export async function GET() {
  const now = new Date();
  const [mode, consumer] = await Promise.all([
    PublicationModeFlag.mode(),
    ConsumerFlags.mode("search-projector"),
  ]);
  const status = SearchStatus.evaluate(
    await SearchStatus.load(db, {
      mode,
      consumer,
      environment: AlgoliaDeployment.parse(process.env.VERCEL_ENV),
      now,
    }),
    now,
  );
  return Response.json(status, {
    status: status.status === "unhealthy" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}

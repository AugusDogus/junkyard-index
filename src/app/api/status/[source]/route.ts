import { unstable_cache } from "next/cache";
import { isIngestionSource } from "~/lib/ingestion-source";
import { getDurableSourceFreshness } from "~/server/ingestion/durable-ingestion";
import { providerFreshness } from "~/server/ingestion/provider-freshness";

// Four monitors poll every 3 minutes, and sources publish once a day. One
// query per 10 minutes serves them all; a stale flip lags by at most that.
const getCachedSourceFreshness = unstable_cache(
  () => getDurableSourceFreshness(new Date()),
  ["durable-source-freshness"],
  { revalidate: 600 },
);

// Better Stack monitors this endpoint for providers without a heartbeat slot:
// 200 while the provider's inventory is fresh, 503 once it goes stale.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ source: string }> },
) {
  const { source } = await params;
  if (!isIngestionSource(source)) {
    return Response.json(
      { error: `Unknown ingestion source "${source}".` },
      { status: 404 },
    );
  }
  const now = new Date();
  const provider = providerFreshness(
    await getCachedSourceFreshness(),
    now,
  ).find((entry) => entry.source === source);
  return Response.json(
    {
      source,
      name: provider?.name ?? source,
      fresh: provider?.fresh ?? false,
      lastPublishedAt: provider?.lastPublishedAt?.toISOString() ?? null,
    },
    {
      status: provider?.fresh ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

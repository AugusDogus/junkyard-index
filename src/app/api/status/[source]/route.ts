import { isIngestionSource } from "~/lib/ingestion-source";
import { getDurableSourceFreshness } from "~/server/ingestion/durable-ingestion";
import { providerFreshness } from "~/server/ingestion/provider-freshness";

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
    await getDurableSourceFreshness(now),
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

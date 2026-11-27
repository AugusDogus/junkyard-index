import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import {
  YardInventoryView,
  yardPageMetadata,
} from "~/components/junkyards/YardInventoryView";
import { dormantYardMetadata } from "~/lib/yard-page-metadata";
import { YardInventory } from "~/lib/yard-inventory";
import { getMakeSlugs } from "~/server/vehicle-models";
import { getHiddenSources } from "~/server/source-control/hidden-sources-loader";
import { getYardPageData, getYardVehiclePage } from "~/server/yard-inventory";

// Served from the CDN and rebuilt after each daily ingestion pass, which
// invalidates the inventory cache tag. This is the fallback lifetime.
export const revalidate = 86400;
export const dynamicParams = true;

type Params = { state: string; yard: string };

/** Yards render on first request, so builds never touch the database. */
export function generateStaticParams(): Params[] {
  return [];
}

async function load(params: Promise<Params>) {
  const { state, yard } = await params;
  const data = await getYardPageData(state, yard);
  if (!data) return null;
  const listing = await getYardVehiclePage(
    data.yard,
    data.summary,
    { kind: "yard" },
    1,
  );
  return { data, summary: listing.summary, inventory: listing.data };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const loaded = await load(params);
  if (!loaded?.inventory) return {};
  const { data, summary } = loaded;
  if (data.dormant) return dormantYardMetadata(data.yard, data.dormant, null);
  return yardPageMetadata(data.yard, summary.total, data.publishedAt, 1);
}

export default async function YardPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const loaded = await load(params);
  if (!loaded?.inventory) notFound();
  const { data, summary, inventory } = loaded;
  const arrivals = YardInventory.yardArrivals(summary);

  return (
    <PublicPageShell>
      <YardInventoryView
        yard={data.yard}
        inventory={inventory}
        total={summary.total}
        makes={summary.makes}
        makeSlugs={await getMakeSlugs()}
        hiddenSources={await getHiddenSources()}
        newArrivals={YardInventory.newArrivalsFrom(
          arrivals,
          arrivals,
          new Date().toISOString(),
        )}
        filter={null}
        publishedAt={data.publishedAt}
        checkedAt={data.checkedAt}
        checkUnknown={data.checkUnknown}
        nearby={data.nearby}
        chain={data.chain}
        dormant={data.dormant}
      />
    </PublicPageShell>
  );
}

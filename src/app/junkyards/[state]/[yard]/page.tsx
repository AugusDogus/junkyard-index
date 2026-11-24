import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import {
  YardInventoryView,
  yardPageMetadata,
} from "~/components/junkyards/YardInventoryView";
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

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { state, yard } = await params;
  const data = await getYardPageData(state, yard);
  if (!data) return {};
  return yardPageMetadata(data.yard, data.summary.total, data.publishedAt, 1);
}

export default async function YardPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { state, yard } = await params;
  const data = await getYardPageData(state, yard);
  const listing =
    data &&
    (await getYardVehiclePage(data.yard, data.summary, { kind: "yard" }, 1));
  if (!data || !listing?.data) notFound();
  const { summary, data: inventory } = listing;
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
        nearby={data.nearby}
        chain={data.chain}
      />
    </PublicPageShell>
  );
}

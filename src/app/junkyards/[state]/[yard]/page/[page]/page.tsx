import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import {
  YardInventoryView,
  yardPageMetadata,
} from "~/components/junkyards/YardInventoryView";
import { YardInventory } from "~/lib/yard-inventory";
import { YardPath } from "~/lib/yard-path";
import { getMakeSlugs } from "~/server/vehicle-models";
import { getHiddenSources } from "~/server/source-control/hidden-sources-loader";
import { getYardPageData, getYardVehiclePage } from "~/server/yard-inventory";

// See ../../page.tsx: rebuilt after each daily pass; this is the fallback.
export const revalidate = 86400;
export const dynamicParams = true;

type Params = { state: string; yard: string; page: string };

export function generateStaticParams(): Params[] {
  return [];
}

async function load(params: Promise<Params>) {
  const { state, yard, page } = await params;
  const number = YardPath.pageNumber(page);
  if (number === null) return null;
  const data = await getYardPageData(state, yard);
  if (!data) return null;
  const listing = await getYardVehiclePage(
    data.yard,
    data.summary,
    { kind: "yard" },
    number,
  );
  return {
    data,
    number,
    summary: listing.summary,
    inventory: listing.data,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const loaded = await load(params);
  if (!loaded?.inventory) return {};
  const { data, number, summary } = loaded;
  return yardPageMetadata(data.yard, summary.total, data.publishedAt, number);
}

export default async function YardInventoryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const loaded = await load(params);
  if (!loaded) notFound();
  const { data, number, summary, inventory } = loaded;
  if (number === 1) permanentRedirect(data.yard.path.href);
  if (!inventory) notFound();
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

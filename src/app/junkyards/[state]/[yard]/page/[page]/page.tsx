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
  const inventory = await getYardVehiclePage(
    data.yard,
    data.summary,
    { kind: "yard" },
    number,
  );
  return { data, number, inventory };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const loaded = await load(params);
  if (!loaded?.inventory) return {};
  const { data, number } = loaded;
  return yardPageMetadata(
    data.yard,
    data.summary.total,
    data.publishedAt,
    number,
  );
}

export default async function YardInventoryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const loaded = await load(params);
  if (!loaded) notFound();
  const { data, number, inventory } = loaded;
  if (number === 1) permanentRedirect(data.yard.path.href);
  if (!inventory) notFound();
  const arrivals = YardInventory.yardArrivals(data.summary);

  return (
    <PublicPageShell>
      <YardInventoryView
        yard={data.yard}
        inventory={inventory}
        total={data.summary.total}
        makes={data.summary.makes}
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

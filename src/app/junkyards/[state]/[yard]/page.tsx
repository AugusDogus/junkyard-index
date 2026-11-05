import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import {
  YardInventoryView,
  yardPageMetadata,
} from "~/components/junkyards/YardInventoryView";
import { YardInventory } from "~/lib/yard-inventory";
import { getMakeHrefs } from "~/server/vehicle-models";
import { getYardPageData } from "~/server/yard-inventory";

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
  return yardPageMetadata(data.yard, data.vehicles.length, data.publishedAt, 1);
}

export default async function YardPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { state, yard } = await params;
  const data = await getYardPageData(state, yard);
  const inventory = data && YardInventory.page(data.vehicles, 1);
  if (!data || !inventory) notFound();

  return (
    <PublicPageShell>
      <YardInventoryView
        yard={data.yard}
        inventory={inventory}
        total={data.vehicles.length}
        makes={data.makes}
        makeHrefs={await getMakeHrefs()}
        publishedAt={data.publishedAt}
        nearby={data.nearby}
        chain={data.chain}
      />
    </PublicPageShell>
  );
}

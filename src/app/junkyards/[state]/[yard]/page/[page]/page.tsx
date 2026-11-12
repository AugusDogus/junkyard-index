import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import {
  YardInventoryView,
  yardPageMetadata,
} from "~/components/junkyards/YardInventoryView";
import { YardInventory } from "~/lib/yard-inventory";
import { getYardPageData } from "~/server/yard-inventory";

// See ../../page.tsx: rebuilt after each daily pass; this is the fallback.
export const revalidate = 86400;
export const dynamicParams = true;

type Params = { state: string; yard: string; page: string };

export function generateStaticParams(): Params[] {
  return [];
}

/** Page numbers are canonical decimals from 2 up; anything else is not a page. */
function parsePage(value: string): number | null {
  return /^[1-9]\d{0,3}$/.test(value) ? Number(value) : null;
}

async function load(params: Promise<Params>) {
  const { state, yard, page } = await params;
  const number = parsePage(page);
  if (number === null) return null;
  const data = await getYardPageData(state, yard);
  if (!data) return null;
  return { data, number, inventory: YardInventory.page(data.vehicles, number) };
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
    data.vehicles.length,
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

  return (
    <PublicPageShell>
      <YardInventoryView
        yard={data.yard}
        inventory={inventory}
        total={data.vehicles.length}
        makes={data.makes}
        publishedAt={data.publishedAt}
        nearby={data.nearby}
        chain={data.chain}
      />
    </PublicPageShell>
  );
}

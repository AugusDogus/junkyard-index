import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import {
  YardInventoryView,
  yardMakeMetadata,
} from "~/components/junkyards/YardInventoryView";
import { VehicleName } from "~/lib/vehicle-name";
import { YardInventory } from "~/lib/yard-inventory";
import { YardPath } from "~/lib/yard-path";
import { findMake, getMakeSlugs } from "~/server/vehicle-models";
import { getYardPageData } from "~/server/yard-inventory";

// One make at one yard, narrowed from the yard's cached inventory, so it
// reads nothing new. Rendered on first request and rebuilt with the yard's
// pages after each daily pass; this is the fallback lifetime.
export const revalidate = 86400;
export const dynamicParams = true;

type Params = { state: string; yard: string; make: string };

export function generateStaticParams(): Params[] {
  return [];
}

// getYardPageData and findMake are cached per request by their arguments.
async function load(params: Promise<Params>) {
  const { state, yard, make: makeSlug } = await params;
  const [data, make] = await Promise.all([
    getYardPageData(state, yard),
    findMake(makeSlug),
  ]);
  if (!data || !make) return null;
  const vehicles = data.vehicles.filter(
    (vehicle) => VehicleName.makeKey(vehicle.make) === make.key,
  );
  return { data, make, makeSlug, vehicles };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const loaded = await load(params);
  if (!loaded || loaded.vehicles.length === 0) return {};
  const { data, make, vehicles } = loaded;
  return yardMakeMetadata(
    data.yard,
    { name: make.name, slug: make.slug },
    vehicles.length,
    data.publishedAt,
  );
}

export default async function YardMakePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const loaded = await load(params);
  if (!loaded) notFound();
  const { data, make, makeSlug, vehicles } = loaded;
  // Other spellings and aliases ("chevy") move to the make's own slug.
  if (makeSlug !== make.slug) {
    permanentRedirect(YardPath.makeHref(data.yard.path, make.slug));
  }
  if (vehicles.length === 0) notFound();

  return (
    <PublicPageShell>
      <YardInventoryView
        yard={data.yard}
        inventory={{ page: 1, pageCount: 1, firstIndex: 0, vehicles }}
        total={vehicles.length}
        newCount={YardInventory.newCount(vehicles, data.publishedAt)}
        // Judged from the whole yard: one new Honda at a long-tracked yard
        // is news, even though it's all of this page.
        newIsMeaningful={YardInventory.newIsMeaningful(
          YardInventory.newCount(data.vehicles, data.publishedAt),
          data.vehicles.length,
        )}
        makes={data.makes}
        makeSlugs={await getMakeSlugs()}
        publishedAt={data.publishedAt}
        nearby={data.nearby}
        chain={data.chain}
        filter={{ name: make.name, slug: make.slug }}
      />
    </PublicPageShell>
  );
}

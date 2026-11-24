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
import { getMakePageData, getMakeSlugs } from "~/server/vehicle-models";
import { getHiddenSources } from "~/server/source-control/hidden-sources-loader";
import { getYardPageData } from "~/server/yard-inventory";

// One model at one yard, narrowed from the yard's cached inventory, so it
// reads nothing new. Rendered on first request and rebuilt with the yard's
// pages after each daily pass; this is the fallback lifetime.
export const revalidate = 86400;
export const dynamicParams = true;

type Params = { state: string; yard: string; make: string; model: string };

export function generateStaticParams(): Params[] {
  return [];
}

// getYardPageData and findMake are cached per request by their arguments.
async function load(params: Promise<Params>) {
  const { state, yard, make: makeSlug, model: modelSlug } = await params;
  const [data, makeData] = await Promise.all([
    getYardPageData(state, yard),
    getMakePageData(makeSlug),
  ]);
  if (!data || !makeData) return null;
  const { make, models } = makeData;
  const wanted = VehicleName.modelKey(make.name, modelSlug.replace(/-/g, " "));
  const model = models.find(
    (candidate) =>
      candidate.key === wanted ||
      VehicleName.sameSlug(candidate.slug, modelSlug),
  );
  if (!model) return null;
  const vehicles = YardInventory.forModel(data.vehicles, make.key, model.key);
  return { data, make, model, makeSlug, modelSlug, vehicles };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const loaded = await load(params);
  if (!loaded || loaded.vehicles.length === 0) return {};
  const { data, make, model, vehicles } = loaded;
  return yardMakeMetadata(
    data.yard,
    {
      name: make.name,
      slug: make.slug,
      model: { name: model.name, slug: model.slug },
    },
    vehicles.length,
    data.publishedAt,
  );
}

export default async function YardModelPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const loaded = await load(params);
  if (!loaded) notFound();
  const { data, make, model, makeSlug, modelSlug, vehicles } = loaded;
  // Other spellings and aliases ("chevy") move to the make's own slug.
  if (makeSlug !== make.slug || modelSlug !== model.slug) {
    permanentRedirect(
      YardPath.modelHref(data.yard.path, make.slug, model.slug),
    );
  }
  if (vehicles.length === 0) notFound();

  return (
    <PublicPageShell>
      <YardInventoryView
        yard={data.yard}
        inventory={{ page: 1, pageCount: 1, firstIndex: 0, vehicles }}
        total={vehicles.length}
        newArrivals={YardInventory.newArrivals(
          vehicles,
          data.vehicles,
          new Date().toISOString(),
        )}
        makes={data.makes}
        makeSlugs={await getMakeSlugs()}
        hiddenSources={await getHiddenSources()}
        publishedAt={data.publishedAt}
        nearby={data.nearby}
        chain={data.chain}
        filter={{
          name: make.name,
          slug: make.slug,
          model: { name: model.name, slug: model.slug },
        }}
      />
    </PublicPageShell>
  );
}

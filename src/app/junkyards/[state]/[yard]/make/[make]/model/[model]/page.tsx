import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import {
  YardInventoryView,
  yardMakeMetadata,
} from "~/components/junkyards/YardInventoryView";
import { YardInventory } from "~/lib/yard-inventory";
import { YardPath } from "~/lib/yard-path";
import { getMakeSlugs, getYardModelPageData } from "~/server/vehicle-models";
import { getHiddenSources } from "~/server/source-control/hidden-sources-loader";
import { getYardModelVehicles, getYardPageData } from "~/server/yard-inventory";

// One model at one yard, read from its own small cached list. Rendered
// on each request and never stored as an ISR page: about 100,000 of these
// URLs exist, crawlers asked for about 54,000 a day on Nov 25 2026 (almost
// every one a first visit), and 1-3% of stored pages were ever read again,
// so storing them was about 82% of the ISR writes (about $1.37 a day). The
// data they read stays cached (the yard's summary and the make's list), so a
// render reads Turso only on a miss, and then just that make's rows.
export const dynamic = "force-dynamic";

type Params = { state: string; yard: string; make: string; model: string };

// getYardPageData and getYardModelPageData are cached per request by their
// arguments.
async function load(params: Promise<Params>) {
  const { state, yard, make: makeSlug, model: modelSlug } = await params;
  const [data, found] = await Promise.all([
    getYardPageData(state, yard),
    getYardModelPageData(makeSlug, modelSlug),
  ]);
  if (!data || !found) return null;
  const { make, model } = found;
  const vehicles = await getYardModelVehicles(
    data.yard,
    data.summary,
    make.key,
    model,
  );
  return {
    data,
    summary: data.summary,
    make,
    model,
    makeSlug,
    modelSlug,
    vehicles,
  };
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
  const { data, summary, make, model, makeSlug, modelSlug, vehicles } = loaded;
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
        newArrivals={YardInventory.newArrivalsFrom(
          YardInventory.arrivals(vehicles),
          YardInventory.yardArrivals(summary),
          new Date().toISOString(),
        )}
        makes={summary.makes}
        makeSlugs={await getMakeSlugs()}
        hiddenSources={await getHiddenSources()}
        publishedAt={data.publishedAt}
        checkedAt={data.checkedAt}
        checkUnknown={data.checkUnknown}
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

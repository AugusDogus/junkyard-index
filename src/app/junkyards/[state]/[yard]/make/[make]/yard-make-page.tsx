import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import {
  YardInventoryView,
  yardMakeMetadata,
} from "~/components/junkyards/YardInventoryView";
import { YardInventory } from "~/lib/yard-inventory";
import { YardPath } from "~/lib/yard-path";
import { findMake, getMakeSlugs } from "~/server/vehicle-models";
import { getHiddenSources } from "~/server/source-control/hidden-sources-loader";
import {
  getYardPageData,
  getYardVehiclePage,
  type YardScope,
} from "~/server/yard-inventory";

export type YardMakeParams = { state: string; yard: string; make: string };

// getYardPageData and findMake are cached per request by their arguments.
async function load(
  { state, yard, make: makeSlug }: YardMakeParams,
  page: number,
) {
  const [data, make] = await Promise.all([
    getYardPageData(state, yard),
    findMake(makeSlug),
  ]);
  if (!data || !make) return null;
  const scope: YardScope = { kind: "make", key: make.key };
  const listing = await getYardVehiclePage(
    data.yard,
    data.summary,
    scope,
    page,
  );
  return {
    data,
    make,
    makeSlug,
    summary: listing.summary,
    inventory: listing.data,
  };
}

/** Sends /page/1 to the make's own canonical URL in one redirect. */
export async function redirectToFirstPage(params: YardMakeParams) {
  const [data, make] = await Promise.all([
    getYardPageData(params.state, params.yard),
    findMake(params.make),
  ]);
  if (!data || !make) notFound();
  permanentRedirect(YardPath.makePageHref(data.yard.path, make.slug, 1));
}

/** Metadata for page `page` of one make at a yard. */
export async function yardMakePageMetadata(
  params: YardMakeParams,
  page: number,
): Promise<Metadata> {
  const loaded = await load(params, page);
  if (!loaded?.inventory) return {};
  const { data, make, summary } = loaded;
  return yardMakeMetadata(
    data.yard,
    { name: make.name, slug: make.slug },
    YardInventory.makeArrivals(summary, make.key).total,
    data.publishedAt,
    page,
  );
}

/** Page `page` of one make at a yard, narrowed from the yard's cached slices. */
export async function YardMakePage({
  params,
  page,
}: {
  params: YardMakeParams;
  page: number;
}) {
  const loaded = await load(params, page);
  if (!loaded) notFound();
  const { data, make, makeSlug, summary, inventory } = loaded;
  // Other spellings and aliases ("chevy") move to the make's own slug.
  if (makeSlug !== make.slug) {
    permanentRedirect(YardPath.makePageHref(data.yard.path, make.slug, page));
  }
  const arrivals = YardInventory.makeArrivals(summary, make.key);
  if (!inventory || arrivals.total === 0) notFound();

  return (
    <PublicPageShell>
      <YardInventoryView
        yard={data.yard}
        inventory={inventory}
        total={arrivals.total}
        newArrivals={YardInventory.newArrivalsFrom(
          arrivals,
          YardInventory.yardArrivals(summary),
          new Date().toISOString(),
        )}
        makes={summary.makes}
        makeSlugs={await getMakeSlugs()}
        hiddenSources={await getHiddenSources()}
        publishedAt={data.publishedAt}
        nearby={data.nearby}
        chain={data.chain}
        filter={{ name: make.name, slug: make.slug }}
      />
    </PublicPageShell>
  );
}

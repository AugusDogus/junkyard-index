import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  ModelInventoryView,
  modelPageMetadata,
} from "~/components/cars/ModelInventoryView";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import { InventoryFormat } from "~/lib/inventory-format";
import { getModelPageData } from "~/server/vehicle-models";
import { latestPublishedAt } from "~/server/yard-inventory";

// Rebuilt after each daily ingestion pass; this is the fallback lifetime.
export const revalidate = 86400;
export const dynamicParams = true;

type Params = { make: string; model: string };

export function generateStaticParams(): Params[] {
  return [];
}

async function load(params: Promise<Params>) {
  const requested = await params;
  const data = await getModelPageData(requested.make, requested.model);
  if (!data) return null;
  const yards = data.model.yards.flatMap((entry) => {
    const yard = data.yards.get(`${entry.source}:${entry.code}`);
    return yard
      ? [{ yard, count: entry.count, years: InventoryFormat.years(entry) }]
      : [];
  });
  const publishedAt = await latestPublishedAt(yards.map(({ yard }) => yard));
  const canonical =
    requested.make === data.make.slug && requested.model === data.model.slug;
  return { ...data, yards, publishedAt, canonical };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const data = await load(params);
  if (!data) return {};
  return modelPageMetadata(
    data.make,
    data.model,
    data.yards.length,
    data.publishedAt,
  );
}

export default async function ModelPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const data = await load(params);
  if (!data) notFound();
  // "/cars/mazda/mazda-3" and "/cars/mazda/mazda3" are the same model.
  if (!data.canonical) permanentRedirect(data.model.href);

  return (
    <PublicPageShell>
      <ModelInventoryView
        make={data.make}
        model={data.model}
        yards={data.yards}
        arrivals={data.arrivals}
        publishedAt={data.publishedAt}
      />
    </PublicPageShell>
  );
}

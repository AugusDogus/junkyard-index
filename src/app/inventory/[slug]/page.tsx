import { notFound, permanentRedirect } from "next/navigation";
import { getRoutedYards } from "~/server/yard-inventory";

// Redirects are cached like pages and rebuilt with the daily pass.
export const revalidate = 86400;
export const dynamicParams = true;

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return [];
}

/**
 * Old links copy LKQ Pick Your Part's own URLs, such as
 * /inventory/LKQ-clearwater-1190, ending in the yard's code. Send them to
 * that yard's page.
 */
export default async function LegacyInventoryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const code = /-(\d+)$/.exec(slug)?.[1];
  const yard = code
    ? (await getRoutedYards()).find(
        (candidate) => candidate.source === "pyp" && candidate.code === code,
      )
    : undefined;
  if (!yard) notFound();
  permanentRedirect(yard.path.href);
}

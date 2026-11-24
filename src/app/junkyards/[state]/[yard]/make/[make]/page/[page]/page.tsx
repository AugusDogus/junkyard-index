import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { YardPath } from "~/lib/yard-path";
import {
  redirectToFirstPage,
  YardMakePage,
  yardMakePageMetadata,
  type YardMakeParams,
} from "../../yard-make-page";

// See ../../page.tsx: rebuilt after each daily pass; this is the fallback.
export const revalidate = 86400;
export const dynamicParams = true;

type Params = YardMakeParams & { page: string };

export function generateStaticParams(): Params[] {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { page, ...make } = await params;
  const number = YardPath.pageNumber(page);
  return number === null ? {} : yardMakePageMetadata(make, number);
}

export default async function YardMakeInventoryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { page, ...make } = await params;
  const number = YardPath.pageNumber(page);
  if (number === null) notFound();
  // The first page lives at the make's own URL.
  if (number === 1) await redirectToFirstPage(make);
  return <YardMakePage params={make} page={number} />;
}

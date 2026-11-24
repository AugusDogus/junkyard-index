import type { Metadata } from "next";
import {
  YardMakePage,
  yardMakePageMetadata,
  type YardMakeParams,
} from "./yard-make-page";

// One make at one yard, narrowed from the yard's cached inventory, so it
// reads nothing new. Rendered on first request and rebuilt with the yard's
// pages after each daily pass; this is the fallback lifetime.
export const revalidate = 86400;
export const dynamicParams = true;

export function generateStaticParams(): YardMakeParams[] {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<YardMakeParams>;
}): Promise<Metadata> {
  return yardMakePageMetadata(await params, 1);
}

export default async function YardMakeFirstPage({
  params,
}: {
  params: Promise<YardMakeParams>;
}) {
  return <YardMakePage params={await params} page={1} />;
}

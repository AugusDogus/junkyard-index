import { addCacheTag } from "@vercel/functions";
import {
  INVENTORY_CACHE_TAG,
  INVENTORY_SOURCES_TAG,
  inventorySourceTag,
  inventoryYardTag,
} from "~/lib/inventory-cache";
import { SOURCE_CONTROL_CACHE_TAG } from "~/server/source-control/hidden-sources-loader";

/**
 * Tags a page response that Vercel's CDN keeps, so the cache tags that
 * expire the page's data also purge the page (Vercel purges CDN, Runtime
 * and Data Cache entries by tag). Next sends no tags with a dynamic page,
 * so without these a purge would never reach it.
 *
 * Every page clears at each inventory refresh and staleness-class change
 * (inventory tag: nearby yards, dates, staleness labels and hidden sources
 * come from directory entries under it) and when an admin hides or shows a
 * source (source-control tag). A known yard's page also clears when its own
 * entries expire (yard, source and sources tags).
 */
export async function tagYardPageResponse(
  yard: { source: string; code: string } | null,
): Promise<void> {
  const tags = [
    INVENTORY_CACHE_TAG,
    SOURCE_CONTROL_CACHE_TAG,
    INVENTORY_SOURCES_TAG,
  ];
  if (yard) {
    tags.push(
      inventorySourceTag(yard.source),
      inventoryYardTag(yard.source, yard.code),
    );
  }
  await Promise.all(tags.map((tag) => addCacheTag(tag)));
}

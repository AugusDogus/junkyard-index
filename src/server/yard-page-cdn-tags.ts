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
 * expire the yard's data also purge the page (Vercel purges CDN, Runtime
 * and Data Cache entries by tag). Next sends no tags with a dynamic page,
 * so without these a purge would never reach it.
 *
 * - A known yard's page clears when its inventory changes (yard tag), when
 *   its source changes staleness class or ends a run without publishing
 *   (source tag), when every yard changes (sources tag), and when an admin
 *   hides or shows a source (source-control tag).
 * - A page for an unknown yard (a 404) also clears at every publication,
 *   which may add that yard.
 */
export async function tagYardPageResponse(
  yard: { source: string; code: string } | null,
): Promise<void> {
  const tags = yard
    ? [
        INVENTORY_SOURCES_TAG,
        inventorySourceTag(yard.source),
        inventoryYardTag(yard.source, yard.code),
        SOURCE_CONTROL_CACHE_TAG,
      ]
    : [INVENTORY_CACHE_TAG, INVENTORY_SOURCES_TAG, SOURCE_CONTROL_CACHE_TAG];
  await Promise.all(tags.map((tag) => addCacheTag(tag)));
}

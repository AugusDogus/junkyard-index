import { revalidateTag } from "next/cache";
import {
  INVENTORY_CACHE_TAG,
  INVENTORY_SOURCES_TAG,
  inventorySourceTag,
  inventoryYardTag,
  type ChangedInventorySources,
} from "~/lib/inventory-cache";

/**
 * Expired at once, not stale-while-revalidate ("max"): a stale entry is
 * served to the render that refreshes it, and a page rendered from it is
 * then kept as new, for a day at Vercel's CDN (yard model pages) or until
 * the next expiry (ISR pages). Costs no more reads or writes than "max";
 * the first request after an expiry waits for the render.
 */
const AT_ONCE = { expire: 0 };

/**
 * Expires the inventory caches after a publication: every entry under the
 * inventory tag (directories, homepage, make and model pages, which list
 * every source), and the per-yard entries of `changed` alone.
 */
export function expireInventoryCaches(changed: ChangedInventorySources): void {
  revalidateTag(INVENTORY_CACHE_TAG, AT_ONCE);
  if (changed.kind === "all") {
    revalidateTag(INVENTORY_SOURCES_TAG, AT_ONCE);
    return;
  }
  for (const source of changed.sources) {
    revalidateTag(inventorySourceTag(source), AT_ONCE);
  }
  for (const { source, code } of changed.yards) {
    revalidateTag(inventoryYardTag(source, code), AT_ONCE);
  }
}

import { revalidateTag } from "next/cache";
import {
  INVENTORY_CACHE_TAG,
  INVENTORY_SOURCES_TAG,
  inventorySourceTag,
  inventoryYardTag,
  type ChangedInventorySources,
} from "~/lib/inventory-cache";

/**
 * Expires the inventory caches after a publication: every entry under the
 * inventory tag (directories, homepage, make and model pages, which list
 * every source), and the per-yard entries of `changed` alone.
 */
export function expireInventoryCaches(changed: ChangedInventorySources): void {
  revalidateTag(INVENTORY_CACHE_TAG, "max");
  if (changed.kind === "all") {
    revalidateTag(INVENTORY_SOURCES_TAG, "max");
    return;
  }
  for (const source of changed.sources) {
    revalidateTag(inventorySourceTag(source), "max");
  }
  for (const { source, code } of changed.yards) {
    revalidateTag(inventoryYardTag(source, code), "max");
  }
}

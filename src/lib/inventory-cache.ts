import { unstable_cache } from "next/cache";

/**
 * Published inventory changes once a day. Everything cached from it carries
 * this tag, and the daily ingestion pass invalidates it once every source has
 * published (`refreshHomepageStep`).
 */
export const INVENTORY_CACHE_TAG = "daily-inventory";

/** Fallback lifetime for inventory caches if the daily invalidation fails. */
export const INVENTORY_CACHE_SECONDS = 24 * 60 * 60;

/**
 * Caches an inventory loader under `keyParts` and its arguments alone.
 * `unstable_cache` also keys entries on the loader's source text, and each
 * route bundle minifies the same loader differently, so a sitemap and a page
 * would each run the query. Binding hides the source text. Cached entries
 * outlive deployments: bump the version in `keyParts` whenever the loader's
 * query or result shape changes.
 */
export function cacheInventory<Args extends unknown[], Result>(
  load: (...args: Args) => Promise<Result>,
  keyParts: string[],
): (...args: Args) => Promise<Result> {
  return unstable_cache(load.bind(null), keyParts, {
    revalidate: INVENTORY_CACHE_SECONDS,
    tags: [INVENTORY_CACHE_TAG],
  });
}

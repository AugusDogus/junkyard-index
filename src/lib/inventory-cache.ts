import { unstable_cache } from "next/cache";
import { retryTursoRead } from "~/lib/turso-read-retry";

/**
 * Published inventory changes a few times a day. Everything cached from it
 * carries this tag, and the inventory-downstream consumer invalidates it
 * after a new publication, at most every 3 hours
 * (`refreshInventoryCachesStep`).
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
 * query or result shape changes. Loaders are reads, so a transient Turso
 * gateway error is retried (`retryTursoRead`) before the render fails.
 */
export function cacheInventory<Args extends unknown[], Result>(
  load: (...args: Args) => Promise<Result>,
  keyParts: string[],
): (...args: Args) => Promise<Result> {
  const read = (...args: Args) => retryTursoRead(() => load(...args));
  return unstable_cache(read.bind(null), keyParts, {
    revalidate: INVENTORY_CACHE_SECONDS,
    tags: [INVENTORY_CACHE_TAG],
  });
}

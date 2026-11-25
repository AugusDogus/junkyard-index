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
 * Tags every per-source inventory entry (`cacheSourceInventory`), which the
 * inventory tag does not cover. Only a change to every source's vehicles,
 * such as a search-index migration rewriting identities, expires it.
 */
export const INVENTORY_SOURCES_TAG = "inventory-sources";

/** Tags one source's per-source inventory entries. */
export function inventorySourceTag(source: string): string {
  return `inventory-source:${source}`;
}

/** The sources whose vehicles may have changed since the caches last expired. */
export type ChangedInventorySources =
  | { kind: "all" }
  | { kind: "sources"; sources: readonly string[] };

/**
 * Caches an inventory loader under `keyParts` and its arguments alone.
 * `unstable_cache` also keys entries on the loader's source text, and each
 * route bundle minifies the same loader differently, so a sitemap and a page
 * would each run the query. Binding hides the source text. Cached entries
 * outlive deployments and keep the tags they were stored with: bump the
 * version in `keyParts` whenever the loader's query, result shape or tags
 * change. Loaders are reads, so a transient Turso
 * gateway error is retried (`retryTursoRead`) before the render fails.
 * `extraTags` also expire the entries, alongside the inventory tag.
 */
export function cacheInventory<Args extends unknown[], Result>(
  load: (...args: Args) => Promise<Result>,
  keyParts: string[],
  extraTags: readonly string[] = [],
): (...args: Args) => Promise<Result> {
  const read = (...args: Args) => retryTursoRead(() => load(...args));
  return unstable_cache(read.bind(null), keyParts, {
    revalidate: INVENTORY_CACHE_SECONDS,
    tags: [INVENTORY_CACHE_TAG, ...extraTags],
  });
}

/**
 * Caches a loader of one source's inventory (its first argument) like
 * `cacheInventory`, but under that source's tag instead of the inventory
 * tag. A publication then expires only the sources whose yards changed, and
 * a staleness change, which changes no vehicle, expires none of them: each
 * yard's vehicles are read about once a day rather than after every
 * expiry of the inventory tag (about 13 a day, each reading every yard's
 * vehicles, 1.4M rows, in November 2026). Bump the version in `keyParts`
 * whenever the loader's query, result shape or tags change.
 */
export function cacheSourceInventory<Rest extends unknown[], Result>(
  load: (source: string, ...rest: Rest) => Promise<Result>,
  keyParts: string[],
): (source: string, ...rest: Rest) => Promise<Result> {
  const read = (source: string, ...rest: Rest) =>
    retryTursoRead(() => load(source, ...rest));
  const bound = read.bind(null);
  return (source: string, ...rest: Rest) =>
    unstable_cache(bound, keyParts, {
      revalidate: INVENTORY_CACHE_SECONDS,
      tags: [INVENTORY_SOURCES_TAG, inventorySourceTag(source)],
    })(source, ...rest);
}

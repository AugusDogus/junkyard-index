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
 * Tags every per-yard inventory entry (`cacheYardInventory`), which the
 * inventory tag does not cover. Only a change to every source's vehicles,
 * such as a search-index migration rewriting identities, expires it.
 */
export const INVENTORY_SOURCES_TAG = "inventory-sources";

/** Tags every per-yard inventory entry of one source. */
export function inventorySourceTag(source: string): string {
  return `inventory-source:${source}`;
}

/** Tags one yard's inventory entries. */
export function inventoryYardTag(source: string, code: string): string {
  return `inventory-yard:${source}:${code}`;
}

/**
 * What may have changed since the caches last expired: everything, or some
 * sources' yards (all of them) and some single yards.
 */
export type ChangedInventorySources =
  | { kind: "all" }
  | {
      kind: "sources";
      sources: readonly string[];
      yards: readonly { source: string; code: string }[];
    };

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
 * Caches a loader of one yard's inventory (its source and code come first)
 * like `cacheInventory`, but under the yard's and its source's tags instead
 * of the inventory tag. A refresh then expires only the yards whose vehicles
 * changed what their pages show, and a staleness change, which changes no
 * vehicle, expires none of them. Bump the version in `keyParts` whenever the
 * loader's query, result shape or tags change.
 */
export function cacheYardInventory<Rest extends unknown[], Result>(
  load: (source: string, code: string, ...rest: Rest) => Promise<Result>,
  keyParts: string[],
): (source: string, code: string, ...rest: Rest) => Promise<Result> {
  const read = (source: string, code: string, ...rest: Rest) =>
    retryTursoRead(() => load(source, code, ...rest));
  const bound = read.bind(null);
  return (source: string, code: string, ...rest: Rest) =>
    unstable_cache(bound, keyParts, {
      revalidate: INVENTORY_CACHE_SECONDS,
      tags: [
        INVENTORY_SOURCES_TAG,
        inventorySourceTag(source),
        inventoryYardTag(source, code),
      ],
    })(source, code, ...rest);
}

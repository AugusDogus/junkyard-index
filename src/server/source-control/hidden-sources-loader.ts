import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "~/lib/db";
import { HiddenSources } from "~/lib/hidden-source";
import { INVENTORY_CACHE_SECONDS } from "~/lib/inventory-cache";
import { retryTursoRead } from "~/lib/turso-read-retry";
import { SourceControlRepository } from "./source-control-repository";

/**
 * Tags the cached hidden-source list. Hiding or showing a source from /admin
 * expires it (`updateTag`), and with it every prerendered page that read the
 * list, so the next request renders with the new list.
 */
export const SOURCE_CONTROL_CACHE_TAG = "source-control";

async function loadHiddenList(): Promise<string[]> {
  const hidden = await retryTursoRead(() =>
    SourceControlRepository.hiddenSources(db),
  );
  return [...hidden.list];
}

// Bound, so every route bundle shares one entry (see cacheInventory). The
// daily lifetime is only a fallback if an expiry is lost; it matches the
// pages' own, so reading the list does not make them rebuild more often.
const cachedHiddenList = unstable_cache(
  loadHiddenList.bind(null),
  ["hidden-sources-v1"],
  { revalidate: INVENTORY_CACHE_SECONDS, tags: [SOURCE_CONTROL_CACHE_TAG] },
);

/**
 * The sources hidden from the public site, for pages, routes and server
 * actions. Workflows and scripts read `SourceControlRepository.hiddenSources`
 * directly instead: they run outside a request, and alert scans must see a
 * hide at once.
 */
export async function getHiddenSources(): Promise<HiddenSources> {
  return HiddenSources.of(await cachedHiddenList());
}

import "server-only";
import { Hyperbrowser } from "@hyperbrowser/sdk";
import { unstable_cache } from "next/cache";
import { env } from "~/env";
import { AlgoliaDeployment } from "~/lib/algolia-deployment";
import { ALGOLIA_SEARCH_INDEX_NAMES } from "~/lib/constants";
import { polarClient } from "~/lib/polar";
import { billingProductCatalog } from "~/server/billing/configured-product-catalog";
import { AlgoliaBudget, type AlgoliaAccess } from "./algolia-budget";
import { HyperbrowserBudget } from "./hyperbrowser-budget";
import { PaidAccounts } from "./paid-accounts";

/** How long the admin pages reuse a read of another service. */
export const ADMIN_CACHE_SECONDS = 10 * 60;

/**
 * Caches a read of another service for 10 minutes, shared by every admin.
 * Keys start with "admin", which nothing outside src/server/admin uses, and
 * only the admin data loaders call these reads, after `requireAdmin`. The
 * cache stores JSON, so a read must return plain data (no Dates). A failed
 * read throws and is not cached. Bump the version in `name` whenever a
 * read's result shape changes: cached entries outlive deployments.
 *
 * Each key names its 10-minute window. `unstable_cache` serves an expired
 * entry while it refreshes in the background, which could show figures
 * days old; a new window is a new key, so its first visit waits for a
 * fresh read instead, and nothing shown is more than 10 minutes old.
 */
function cacheAdminRead<Result>(
  name: string,
  read: () => Promise<Result>,
): () => Promise<Result> {
  return () => {
    const window = Math.floor(Date.now() / (ADMIN_CACHE_SECONDS * 1000));
    return unstable_cache(read, ["admin", name, String(window)], {
      revalidate: ADMIN_CACHE_SECONDS,
    })();
  };
}

function algoliaAccess(): AlgoliaAccess {
  return {
    appId: env.NEXT_PUBLIC_ALGOLIA_APP_ID,
    apiKey: env.ALGOLIA_WRITE_API_KEY,
    deployment: AlgoliaDeployment.parse(process.env.VERCEL_ENV),
  };
}

/**
 * Reads of Hyperbrowser, Algolia and Polar for the admin pages. None
 * searches Algolia. Callers must have passed `requireAdmin`.
 */
export const AdminCachedReads = {
  hyperbrowser: cacheAdminRead("hyperbrowser-budget-v2", () =>
    HyperbrowserBudget.read(
      new Hyperbrowser({ apiKey: env.HYPERBROWSER_API_KEY }),
      new Date(),
    ),
  ),

  algoliaRecords: cacheAdminRead("algolia-records-v1", () =>
    AlgoliaBudget.records(algoliaAccess(), fetch),
  ),

  algoliaTopSearches: cacheAdminRead("algolia-top-searches-v1", () =>
    AlgoliaBudget.topSearches(
      algoliaAccess(),
      ALGOLIA_SEARCH_INDEX_NAMES,
      new Date(),
      fetch,
    ),
  ),

  paidAccounts: cacheAdminRead("paid-accounts-v1", () =>
    PaidAccounts.read(
      { listSubscriptions: (input) => polarClient.subscriptions.list(input) },
      billingProductCatalog,
      new Date(),
    ),
  ),
} as const;

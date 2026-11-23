import "server-only";
import { db } from "~/lib/db";
import { AdminCachedReads } from "./admin-cached-reads";
import { loadPart } from "./admin-data";
import { requireAdmin } from "./require-admin";
import { SiteAnalytics } from "./site-analytics";

/**
 * The analytics page's reads. Each checks the viewer is an admin first.
 * Database reads are small and uncached; Polar and Algolia reads come from
 * the 10-minute cache. None scans the vehicle table or searches Algolia.
 */
export const AnalyticsData = {
  async users(now: Date) {
    await requireAdmin();
    return loadPart("users", () => SiteAnalytics.users(db, now));
  },

  async savedSearches(now: Date) {
    await requireAdmin();
    return loadPart("saved searches", () =>
      SiteAnalytics.savedSearches(db, now),
    );
  },

  async alerts(now: Date) {
    await requireAdmin();
    return loadPart("alert sends", () => SiteAnalytics.alerts(db, now));
  },

  async paidAccounts() {
    await requireAdmin();
    return loadPart("paid plans from Polar", AdminCachedReads.paidAccounts);
  },

  async topSearches() {
    await requireAdmin();
    return loadPart(
      "top searches from Algolia Analytics",
      AdminCachedReads.algoliaTopSearches,
    );
  },
} as const;

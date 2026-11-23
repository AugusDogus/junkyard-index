import "server-only";
import { AdminCachedReads } from "./admin-cached-reads";
import { loadPart } from "./admin-data";
import { requireAdmin } from "./require-admin";

/**
 * The budgets page's reads. Each checks the viewer is an admin first, then
 * reads the 10-minute cache. None searches Algolia.
 */
export const BudgetData = {
  async hyperbrowser() {
    await requireAdmin();
    return loadPart("Hyperbrowser credits", AdminCachedReads.hyperbrowser);
  },

  async algoliaRecords() {
    await requireAdmin();
    return loadPart("Algolia records", AdminCachedReads.algoliaRecords);
  },
} as const;

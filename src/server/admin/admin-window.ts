import { SOURCE_FRESHNESS_LOOKBACK_DAYS } from "~/server/ingestion/durable-health";

/**
 * Days of runs and alert checks the dashboard reads. At least the public
 * freshness lookback, so admin's "Hidden (stale)" matches what the site
 * hides (admin-window.test.ts checks it).
 */
export const ADMIN_WINDOW_DAYS = SOURCE_FRESHNESS_LOOKBACK_DAYS;

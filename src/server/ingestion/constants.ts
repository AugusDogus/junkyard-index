/**
 * Row52 / AutoRecycler: how often `onProgress` runs. Each call may persist to Turso via
 * `updateSourceRunProgress` in `run-pipeline.ts` (throttled to reduce write volume). PYP reports
 * every page. Short runs still get a **forced** emit on the last page so cursor/counts are current
 * before `completeSourceRun` even when total pages are fewer than this interval.
 */
export const DEFAULT_INGESTION_PROGRESS_PAGE_INTERVAL = 10;

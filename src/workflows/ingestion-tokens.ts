import type { DownstreamConsumer } from "~/server/ingestion/consumer-flags";

// Hook tokens shared by the ingestion pass, its source run workflows, and the
// steps that signal them.
export const IngestionTokens = {
  /** Each source run's workflow reports to its day's pass here. */
  passReports(day: string): string {
    return `vehicle-ingestion-pass:${day}`;
  },
  /** One live workflow per source run. */
  run(runId: string): string {
    return `vehicle-ingestion:${runId}`;
  },
  /** One live saved-search alert check per ingestion day. */
  searchAlertCheck(day: string): string {
    return `search-alert-check:${day}`;
  },
  /** One live workflow per downstream consumer. */
  consumer(consumer: DownstreamConsumer): string {
    return `downstream-consumer:${consumer}`;
  },
  /**
   * The singleton search projector. The search-index migration also holds
   * it while it writes, so the two never write the index at once.
   */
  searchProjector: "search-projector",
  /**
   * Held by inline search writers (a source run projecting or rebuilding,
   * the search-index migration) so one writes at a time. Shared with older
   * deployments, so the string never changes.
   */
  algoliaWrites: "algolia-writes",
  /** Wakes a run waiting for the shared commit. */
  commitTurn(runId: string): string {
    return `vehicle-ingestion-commit-turn:${runId}`;
  },
} as const;

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
  /** Wakes a run waiting for the shared commit. */
  commitTurn(runId: string): string {
    return `vehicle-ingestion-commit-turn:${runId}`;
  },
} as const;

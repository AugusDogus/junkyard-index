export type DurableIngestionHealth = "healthy" | "degraded" | "down";

const ATTEMPTED_WITHIN_MS = 24 * 60 * 60 * 1000;
const STALE_AFTER_MS = 30 * 60 * 60 * 1000;

export interface IngestionSourceFreshness {
  source: string;
  lastAttemptAt: number;
  lastPublishedAt: number | null;
}

/**
 * Sources attempted in the last day, and those among them whose last accepted
 * publication is over 30 hours old. A failed attempt with retries left is not
 * stale yet; a disabled source stops being attempted and drops out after a day.
 */
export function assessIngestionFreshness(
  sources: readonly IngestionSourceFreshness[],
  now: Date,
): { attempted: string[]; stale: string[] } {
  const attempted = sources.filter(
    (source) => now.getTime() - source.lastAttemptAt <= ATTEMPTED_WITHIN_MS,
  );
  return {
    attempted: attempted.map((source) => source.source),
    stale: attempted
      .filter(
        (source) =>
          source.lastPublishedAt === null ||
          now.getTime() - source.lastPublishedAt > STALE_AFTER_MS,
      )
      .map((source) => source.source),
  };
}

/**
 * Down when every attempted source is stale. Degraded when some source is
 * stale or a run just failed, since sources ingest as separate jobs.
 */
export function classifyDurableIngestionHealth(params: {
  runFailed: boolean;
  attempted: readonly string[];
  stale: readonly string[];
}): DurableIngestionHealth {
  if (
    params.attempted.length > 0 &&
    params.stale.length === params.attempted.length
  )
    return "down";
  return params.runFailed || params.stale.length > 0 ? "degraded" : "healthy";
}

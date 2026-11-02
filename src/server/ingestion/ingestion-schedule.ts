import type { DurableIngestionSource } from "./durable-source";

/** One source's ingestion attempts on the current ingestion day. */
export interface IngestionSourceDay {
  source: string;
  /** An accepted snapshot of this source reached search today. */
  published: boolean;
  attempts: number;
  lastStartedAt: number | null;
}

const MAX_ATTEMPTS_PER_DAY = 3;
const RETRY_DELAY_MS = 2 * 60 * 60 * 1000;

// Each source runs as its own job: a failing source retries a few times a
// day without recrawling the others, and stops for the day after its last
// attempt.
export const IngestionSchedule = {
  maxAttemptsPerDay: MAX_ATTEMPTS_PER_DAY,
  retryDelayMs: RETRY_DELAY_MS,

  /**
   * Enabled sources to start now: those that have not published today, have
   * attempts left, and are past their retry delay. Callers skip sources that
   * already have an active run.
   */
  dueSources(params: {
    days: readonly IngestionSourceDay[];
    enabledSources: readonly DurableIngestionSource[];
    now: Date;
  }): DurableIngestionSource[] {
    const daysBySource = new Map(params.days.map((day) => [day.source, day]));
    return params.enabledSources.filter((source) => {
      const day = daysBySource.get(source);
      if (!day) return true;
      if (day.published || day.attempts >= MAX_ATTEMPTS_PER_DAY) return false;
      return (
        day.lastStartedAt === null ||
        params.now.getTime() - day.lastStartedAt >= RETRY_DELAY_MS
      );
    });
  },

  /**
   * Whether today's pass is over: every enabled source has published or used
   * its attempts. A source waiting out a retry delay keeps the pass open.
   */
  passComplete(params: {
    days: readonly IngestionSourceDay[];
    enabledSources: readonly DurableIngestionSource[];
  }): boolean {
    const daysBySource = new Map(params.days.map((day) => [day.source, day]));
    return params.enabledSources.every((source) => {
      const day = daysBySource.get(source);
      return (
        day !== undefined &&
        (day.published || day.attempts >= MAX_ATTEMPTS_PER_DAY)
      );
    });
  },
} as const;

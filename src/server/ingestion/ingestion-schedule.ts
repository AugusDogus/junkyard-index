import type { DurableIngestionSource } from "./durable-source";
import { IngestionDay } from "./ingestion-day";

/** One source's ingestion attempts on the current ingestion day. */
export interface IngestionSourceDay {
  source: string;
  /** An accepted snapshot of this source reached search today. */
  published: boolean;
  attempts: number;
  lastStartedAt: number | null;
  lastCompletedAt: number | null;
  validationRejected: boolean;
}

const MAX_ATTEMPTS_PER_DAY = 3;
const HOUR_MS = 60 * 60 * 1000;
const RETRY_DELAY_MS = 2 * HOUR_MS;

/**
 * Sources whose first daily attempt waits past the 07:00 UTC day boundary,
 * by delay. Ario imports AutoRecycler's Ez Pull N Pay and Foss yards at 08:30
 * to 08:52 UTC (measured Nov 5 to 25, 2026), so a 07:00 crawl published those
 * arrivals a day late. 09:15 leaves room for a slow import; the crawl stages
 * in about 6 minutes, well before the daily commit queue drains.
 */
const START_DELAY_MS: Partial<Record<DurableIngestionSource, number>> = {
  autorecycler: 2.25 * HOUR_MS,
};

/** The earliest a source may start on the ingestion day of `now`. */
function startAt(source: DurableIngestionSource, now: Date): number {
  return IngestionDay.start(now).getTime() + (START_DELAY_MS[source] ?? 0);
}

function retryAt(day: IngestionSourceDay): number {
  return (
    Math.max(day.lastStartedAt ?? 0, day.lastCompletedAt ?? 0) + RETRY_DELAY_MS
  );
}

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
      if (params.now.getTime() < startAt(source, params.now)) return false;
      const day = daysBySource.get(source);
      if (!day) return true;
      if (
        day.published ||
        day.validationRejected ||
        day.attempts >= MAX_ATTEMPTS_PER_DAY
      )
        return false;
      return params.now.getTime() >= retryAt(day);
    });
  },

  /**
   * When the earliest waiting source's retry delay or delayed daily start
   * ends, if any is waiting.
   */
  nextRetryAt(params: {
    days: readonly IngestionSourceDay[];
    enabledSources: readonly DurableIngestionSource[];
    now: Date;
  }): number | null {
    const daysBySource = new Map(params.days.map((day) => [day.source, day]));
    const retryTimes = params.enabledSources.flatMap((source) => {
      const day = daysBySource.get(source);
      const start = startAt(source, params.now);
      if (!day) return start > params.now.getTime() ? [start] : [];
      return !day.published &&
        !day.validationRejected &&
        day.attempts < MAX_ATTEMPTS_PER_DAY &&
        (day.lastStartedAt !== null || day.lastCompletedAt !== null)
        ? [Math.max(retryAt(day), start)]
        : [];
    });
    return retryTimes.length === 0 ? null : Math.min(...retryTimes);
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
        (day.published ||
          day.validationRejected ||
          day.attempts >= MAX_ATTEMPTS_PER_DAY)
      );
    });
  },
} as const;

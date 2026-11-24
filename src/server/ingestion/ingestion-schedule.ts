import {
  ingestionSourceCadenceDays,
  ingestionSourceMaxAttemptsPerDay,
  type IngestionSource,
} from "~/lib/ingestion-source";
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

/**
 * A source's latest crawl days within the schedule's look-back, as ingestion
 * day keys (`schedule_key`): the day of its latest run, and of its latest
 * accepted run, if any. A latest run on a later day than the latest accepted
 * one ended a failed crawl day, unless it is still running.
 */
export interface SourceCrawlDays {
  lastAttemptDay: string;
  lastAcceptedDay: string | null;
}

const RETRY_DELAY_MS = 2 * 60 * 60 * 1000;

function retryAt(day: IngestionSourceDay): number {
  return (
    Math.max(day.lastStartedAt ?? 0, day.lastCompletedAt ?? 0) + RETRY_DELAY_MS
  );
}

/** Whether a source crawled less often than daily rests on `now`'s day: on
 * the days after its latest accepted run's day until its cadence has passed,
 * and on the day after a failed crawl day. */
function rests(
  cadenceDays: number,
  crawl: SourceCrawlDays | undefined,
  now: Date,
): boolean {
  if (cadenceDays === 1 || crawl === undefined) return false;
  const since = (key: string) => IngestionDay.daysSinceKey(key, now);
  const accepted = crawl.lastAcceptedDay;
  if (accepted !== null) {
    const days = since(accepted);
    if (days > 0 && days < cadenceDays) return true;
  }
  return crawl.lastAttemptDay !== accepted && since(crawl.lastAttemptDay) === 1;
}

/** When a source crawled less often than daily is next scheduled after
 * resting on `now`'s day: the first day it no longer rests. */
function nextScheduledDay(
  cadenceDays: number,
  crawl: SourceCrawlDays,
  now: Date,
): string {
  for (let ahead = 1; ; ahead++) {
    const day = new Date(now.getTime() + ahead * 24 * 60 * 60 * 1000);
    if (!rests(cadenceDays, crawl, day)) return IngestionDay.key(day);
  }
}

// Each source runs as its own job: a failing source retries up to its
// `ingestionSourceMaxAttemptsPerDay` a day without recrawling the others, and
// stops for the day after its last attempt.
export const IngestionSchedule = {
  /** Scheduled runs `source` may start on one ingestion day. */
  maxAttemptsPerDay: (source: IngestionSource): number =>
    ingestionSourceMaxAttemptsPerDay(source),
  retryDelayMs: RETRY_DELAY_MS,

  /**
   * Enabled sources scheduled on `now`'s ingestion day by their cadence. A
   * source crawled less often than daily rests on the days after its latest
   * accepted run's ingestion day (the day that run started on, not the day it
   * published) until its cadence has passed, and for one day after a failed
   * crawl day before it retries. One that ran today stays, so the day counts
   * it as done. A daily source is always scheduled.
   */
  scheduledSources(params: {
    enabledSources: readonly DurableIngestionSource[];
    crawlDays: ReadonlyMap<string, SourceCrawlDays>;
    now: Date;
  }): DurableIngestionSource[] {
    return params.enabledSources.filter(
      (source) =>
        !rests(
          ingestionSourceCadenceDays(source),
          params.crawlDays.get(source),
          params.now,
        ),
    );
  },

  /**
   * The ingestion day key `source` is next crawled on when it rests on
   * `now`'s day, or null when it is scheduled today.
   */
  restingUntil(
    source: IngestionSource,
    crawl: SourceCrawlDays | undefined,
    now: Date,
  ): string | null {
    const cadenceDays = ingestionSourceCadenceDays(source);
    return crawl !== undefined && rests(cadenceDays, crawl, now)
      ? nextScheduledDay(cadenceDays, crawl, now)
      : null;
  },

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
      if (
        day.published ||
        day.validationRejected ||
        day.attempts >= ingestionSourceMaxAttemptsPerDay(source)
      )
        return false;
      return params.now.getTime() >= retryAt(day);
    });
  },

  /** When the earliest waiting source's retry delay ends, if any is waiting. */
  nextRetryAt(params: {
    days: readonly IngestionSourceDay[];
    enabledSources: readonly DurableIngestionSource[];
  }): number | null {
    const daysBySource = new Map(params.days.map((day) => [day.source, day]));
    const retryTimes = params.enabledSources.flatMap((source) => {
      const day = daysBySource.get(source);
      return day &&
        !day.published &&
        !day.validationRejected &&
        day.attempts < ingestionSourceMaxAttemptsPerDay(source) &&
        (day.lastStartedAt !== null || day.lastCompletedAt !== null)
        ? [retryAt(day)]
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
          day.attempts >= ingestionSourceMaxAttemptsPerDay(source))
      );
    });
  },
} as const;

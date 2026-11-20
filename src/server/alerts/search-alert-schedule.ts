import { IngestionDay } from "~/server/ingestion/ingestion-day";

// 18:00 UTC. Passes usually finish by 16:00 UTC, including a failing
// source's third attempt; the deadline keeps a stuck source from holding
// back everyone's alerts.
const DEADLINE_OFFSET_MS = 11 * 60 * 60 * 1000;

/** When the daily saved-search alert check is due and when it is stuck. */
export const SearchAlertSchedule = {
  /**
   * A running check that has not progressed for this long is treated as
   * failed or stuck, so delivery stops holding earlier intents for it. A
   * batch normally takes seconds.
   */
  staleAfterMs: 60 * 60 * 1000,

  /** Whether the day's alert deadline has passed, so the check must run. */
  isPastDeadline(now: Date): boolean {
    return (
      now.getTime() >= IngestionDay.start(now).getTime() + DEADLINE_OFFSET_MS
    );
  },
} as const;

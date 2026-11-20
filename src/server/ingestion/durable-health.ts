/**
 * Hours after a source's last accepted inventory publication before every
 * status check (/api/status, /api/status/[source]) calls it stale. Daily runs
 * start at 07:00 UTC and publish within hours; 36 hours allows a late
 * publication followed by an early one without flagging a healthy source, and
 * still catches a source that misses a whole day.
 */
export const SOURCE_STALE_AFTER_HOURS = 36;
const STALE_AFTER_MS = SOURCE_STALE_AFTER_HOURS * 60 * 60 * 1000;

export interface IngestionSourceFreshness {
  source: string;
  lastAttemptAt: number;
  lastPublishedAt: number | null;
}

/**
 * Whether a source's last accepted publication is recent enough to call its
 * inventory fresh. A daily source with one failed attempt is still fresh; a
 * source that misses its whole day goes stale after
 * `SOURCE_STALE_AFTER_HOURS`.
 */
export function isFreshPublication(
  lastPublishedAt: number | null,
  now: Date,
): boolean {
  return (
    lastPublishedAt !== null &&
    now.getTime() - lastPublishedAt <= STALE_AFTER_MS
  );
}

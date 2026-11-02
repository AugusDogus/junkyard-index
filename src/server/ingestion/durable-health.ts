const STALE_AFTER_MS = 30 * 60 * 60 * 1000;

export interface IngestionSourceFreshness {
  source: string;
  lastAttemptAt: number;
  lastPublishedAt: number | null;
}

/**
 * Whether a source's last accepted publication is recent enough to call its
 * inventory fresh. A daily source with one failed attempt is still fresh; a
 * source that misses its whole day goes stale after 30 hours.
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

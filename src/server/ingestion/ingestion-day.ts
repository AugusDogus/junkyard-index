// Both ingestion scheduling and daily notifications use the 07:00 UTC boundary.
const DAY_MS = 24 * 60 * 60 * 1000;
const START_OFFSET_MS = 7 * 60 * 60 * 1000;

export const IngestionDay = {
  start(now: Date): Date {
    return new Date(
      Math.floor((now.getTime() - START_OFFSET_MS) / DAY_MS) * DAY_MS +
        START_OFFSET_MS,
    );
  },
  key(now: Date): string {
    return IngestionDay.start(now).toISOString().slice(0, 10);
  },
} as const;

"use client";

import { useSyncExternalStore } from "react";

const OPTIONS = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
} as const satisfies Intl.DateTimeFormatOptions;

// The server cannot know the viewer's zone, so it writes UTC and says so.
const SERVER_FORMAT = new Intl.DateTimeFormat("en-US", {
  ...OPTIONS,
  timeZone: "UTC",
});
const BROWSER_FORMAT = new Intl.DateTimeFormat(undefined, OPTIONS);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const subscribeNever = () => () => {};

function ago(date: Date, now: number): string {
  const elapsed = now - date.getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  return `${Math.floor(elapsed / DAY)} d ago`;
}

/**
 * A time with its zone and how long ago it was. The server renders it in
 * UTC; once the page is live, it re-renders in the viewer's time zone.
 */
export function AdminTime({
  date,
  empty = "Never",
}: {
  date: Date | null;
  empty?: string;
}) {
  // False on the server and during hydration, true afterwards.
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  if (date === null) {
    return <span className="text-muted-foreground">{empty}</span>;
  }
  const format = hydrated ? BROWSER_FORMAT : SERVER_FORMAT;
  return (
    <time
      dateTime={date.toISOString()}
      title={date.toISOString()}
      // Only "(x ago)" can differ at hydration, when a minute turns over.
      suppressHydrationWarning
    >
      {`${format.format(date)} (${ago(date, Date.now())})`}
    </time>
  );
}

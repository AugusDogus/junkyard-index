"use client";

const FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(date: Date, now: number): string {
  const elapsed = now - date.getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  return `${Math.floor(elapsed / DAY)} d ago`;
}

/**
 * A time in the viewer's time zone, with how long ago it was. The server
 * renders it in its own zone and the browser corrects it on load.
 */
export function AdminTime({
  date,
  empty = "Never",
}: {
  date: Date | null;
  empty?: string;
}) {
  if (date === null) {
    return <span className="text-muted-foreground">{empty}</span>;
  }
  return (
    <time
      dateTime={date.toISOString()}
      title={date.toISOString()}
      suppressHydrationWarning
    >
      {`${FORMAT.format(date)} (${ago(date, Date.now())})`}
    </time>
  );
}

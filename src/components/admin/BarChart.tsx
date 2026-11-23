import type { DayValue } from "~/server/admin/admin-series";

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** A `YYYY-MM-DD` UTC day as "Nov 22". */
export function formatDay(day: string): string {
  return DAY_FORMAT.format(new Date(`${day}T00:00:00Z`));
}

export function formatAmount(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/**
 * One series of bars, one per day or week, with no client script. Hovering
 * a bar shows its value; "Show numbers" opens the same figures as a table,
 * which is also what screen readers get.
 */
export function BarChart({
  title,
  data,
  pointLabel = formatDay,
  pointHeading = "Day",
  valueLabel = formatAmount,
}: {
  title: string;
  data: readonly DayValue[];
  /** How a point's day reads, such as "Nov 22" or "Week of Nov 16". */
  pointLabel?: (day: string) => string;
  /** The table's first column heading. */
  pointHeading?: string;
  valueLabel?: (value: number) => string;
}) {
  const max = Math.max(0, ...data.map((point) => point.value));
  const first = data[0];
  const last = data.at(-1);
  return (
    <figure className="min-w-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground text-xs">
          Highest: {valueLabel(max)}
        </span>
      </figcaption>
      {max === 0 ? (
        <p className="text-muted-foreground mt-3 flex h-28 items-center justify-center rounded-lg border border-dashed text-sm">
          None in this period
        </p>
      ) : (
        <div
          aria-hidden="true"
          className="border-border mt-3 flex h-28 items-end gap-0.5 border-b"
        >
          {data.map((point, index) => {
            const height =
              point.value === 0 ? 0 : Math.max(2, (point.value / max) * 100);
            const align =
              index < data.length / 3
                ? "left-0"
                : index >= (data.length * 2) / 3
                  ? "right-0"
                  : "left-1/2 -translate-x-1/2";
            return (
              <div
                key={point.day}
                className="group relative flex h-full min-w-0 flex-1 items-end"
              >
                <div
                  className="bg-primary group-hover:bg-primary/80 w-full rounded-t-[4px]"
                  style={{ height: `${height}%` }}
                />
                <span
                  className={`bg-popover text-popover-foreground pointer-events-none absolute bottom-full z-10 mb-1 hidden rounded-md border px-2 py-1 text-xs whitespace-nowrap shadow-sm group-hover:block ${align}`}
                >
                  {pointLabel(point.day)}: {valueLabel(point.value)}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {first !== undefined && last !== undefined && (
        <div className="text-muted-foreground mt-1 flex justify-between text-xs">
          <span>{pointLabel(first.day)}</span>
          <span>{pointLabel(last.day)}</span>
        </div>
      )}
      <details className="mt-2">
        <summary className="text-muted-foreground cursor-pointer text-xs">
          Show numbers
        </summary>
        <div className="mt-2 max-h-72 overflow-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  {pointHeading}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {title}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[...data].reverse().map((point) => (
                <tr key={point.day}>
                  <td className="px-3 py-1.5">{pointLabel(point.day)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {valueLabel(point.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

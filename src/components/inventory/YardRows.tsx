import Link from "next/link";

export type YardRow = {
  href: string;
  name: string;
  place: string;
  /** Right-aligned figure, such as a count. */
  figure: string;
  /** Under the figure, such as a year range. */
  detail?: string;
};

/** Yards as a compact, scannable list: easier to compare than cards. */
export function YardRows({ rows }: { rows: readonly YardRow[] }) {
  return (
    // Capped width: name and count stay close enough to read across.
    <ul className="max-w-2xl divide-y border-y">
      {rows.map((row) => (
        <li key={row.href}>
          <Link
            href={row.href}
            prefetch={false}
            className="hover:bg-muted/60 flex items-center justify-between gap-4 px-1 py-2.5"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {row.name}
              </span>
              <span className="text-muted-foreground block truncate text-xs">
                {row.place}
              </span>
            </span>
            <span className="shrink-0 text-right text-sm font-medium tabular-nums">
              {row.figure}
              {row.detail && (
                <span className="text-muted-foreground block text-xs font-normal">
                  {row.detail}
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

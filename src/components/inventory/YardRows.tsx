import Link from "next/link";
import { cn } from "~/lib/utils";

export type YardRow = {
  href: string;
  name: string;
  place: string;
  /** Right-aligned figure, such as a count. */
  figure: string;
  /** Under the figure, such as a year range. */
  detail?: string;
  /** "Last checked N days ago" when the yard's inventory is stale. */
  lastChecked?: string | null;
};

/** The surface the rows sit on: the paper, or the ink board where figures take the figure colour. */
type YardRowsTone = "paper" | "board";

const TONES = {
  paper: {
    list: "border-rule-strong",
    row: "border-rule",
    link: "hover:bg-paper-2 active:bg-paper-2 focus-visible:outline-focus",
    name: "text-ink",
    meta: "text-ink-3",
    stale: "border-warning text-warning",
    figure: "text-ink text-lg",
  },
  board: {
    list: "border-board-rule",
    row: "border-board-rule",
    link: "hover:bg-board-2 active:bg-board-2 focus-visible:outline-figure",
    name: "text-board-ink",
    meta: "text-board-muted",
    stale: "border-board-warning text-board-warning",
    figure: "text-figure text-title",
  },
} as const satisfies Record<YardRowsTone, Record<string, string>>;

/**
 * 1 keeps one capped column, so name and count stay close enough to read
 * across. 2 and 3 run the rows down that many columns on wider screens.
 */
type YardRowsColumns = 1 | 2 | 3;

const COLUMNS = {
  1: "max-w-2xl",
  2: "gap-x-10 sm:columns-2",
  3: "gap-x-10 sm:columns-2 lg:columns-3",
} as const satisfies Record<YardRowsColumns, string>;

/** At most `columns`, and fewer for a short list, so no column holds a lone row. */
function columnsFor(count: number, columns: YardRowsColumns): YardRowsColumns {
  if (columns === 3 && count >= 9) return 3;
  if (columns !== 1 && count >= 4) return 2;
  return 1;
}

/** Yards as a compact, scannable list: easier to compare than cards. */
export function YardRows({
  rows,
  tone = "paper",
  columns = 1,
}: {
  rows: readonly YardRow[];
  tone?: YardRowsTone;
  /** The most columns the rows run down; fewer when the rows are few. */
  columns?: YardRowsColumns;
}) {
  const colours = TONES[tone];
  return (
    <ul
      className={cn(
        "border-t",
        colours.list,
        COLUMNS[columnsFor(rows.length, columns)],
      )}
    >
      {rows.map((row) => (
        <li
          key={row.href}
          className={cn("break-inside-avoid border-b", colours.row)}
        >
          <Link
            href={row.href}
            prefetch={false}
            // The row classes are in globals.css: a model page lists
            // hundreds of yards.
            className={cn("yard-rows-link", colours.link)}
          >
            <span className="min-w-0">
              <span className={cn("yard-rows-name", colours.name)}>
                {row.name}
              </span>
              <span className={cn("block truncate text-sm", colours.meta)}>
                {row.place}
              </span>
              {row.lastChecked && (
                <span
                  className={cn(
                    "mt-1 inline-block border px-1.5 py-0.5 text-xs font-medium",
                    colours.stale,
                  )}
                >
                  {row.lastChecked}
                </span>
              )}
            </span>
            <span
              className={cn(
                "yard-rows-figure",
                colours.figure,
                "leading-tight",
              )}
            >
              {row.figure}
              {row.detail && (
                <span className={cn("block text-sm font-normal", colours.meta)}>
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

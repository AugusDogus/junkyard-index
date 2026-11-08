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
};

/** The surface the rows sit on: the paper, or the ink board where figures turn amber. */
type YardRowsTone = "paper" | "board";

const TONES = {
  paper: {
    list: "border-ink",
    row: "border-rule",
    link: "hover:bg-paper-2 active:bg-paper-2 focus-visible:outline-focus",
    name: "text-ink",
    meta: "text-ink-3",
    figure: "text-ink text-lg",
  },
  board: {
    list: "border-board-ink",
    row: "border-board-rule",
    link: "hover:bg-board-2 active:bg-board-2 focus-visible:outline-figure",
    name: "text-board-ink",
    meta: "text-board-muted",
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
        "border-t-2",
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
            className={cn(
              "board-step flex items-center justify-between gap-4 px-2 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid",
              colours.link,
            )}
          >
            <span className="min-w-0">
              <span
                className={cn(
                  "block text-[0.9375rem] leading-snug font-medium text-pretty",
                  colours.name,
                )}
              >
                {row.name}
              </span>
              <span className={cn("block truncate text-sm", colours.meta)}>
                {row.place}
              </span>
            </span>
            <span
              className={cn(
                "shrink-0 text-right leading-tight font-extrabold tabular-nums",
                colours.figure,
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

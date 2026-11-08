import Link from "next/link";
import { InventoryFormat } from "~/lib/inventory-format";
import { cn } from "~/lib/utils";
import { YardName } from "~/lib/yard-name";
import type { RoutedYard } from "~/server/yard-inventory";

/** The surface the list sits on: the paper, or the ink board where figures turn amber. */
type YardListTone = "paper" | "board";

const TONES = {
  paper: {
    rule: "border-ink",
    head: "text-ink-3",
    row: "border-rule",
    link: "hover:bg-paper-2 active:bg-paper-2 focus-visible:outline-focus",
    name: "text-ink group-hover:text-signal",
    meta: "text-ink-3",
    figure: "text-ink",
  },
  board: {
    rule: "border-board-ink",
    head: "text-board-muted",
    row: "border-board-rule",
    link: "hover:bg-board-2 active:bg-board-2 focus-visible:outline-figure",
    name: "text-board-ink",
    meta: "text-board-muted",
    figure: "text-figure",
  },
} as const satisfies Record<YardListTone, Record<string, string>>;

/** Name, city, count: the same three tracks in the head and every row. */
const TRACKS =
  "sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_7rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)_8rem]";

/**
 * Links to yards' inventory pages as an index: the yard, its city and its
 * live count in columns, under one head row. Phones stack the city under
 * the name and say the unit beside the figure.
 */
export function YardList({
  yards,
  tone = "paper",
}: {
  yards: readonly RoutedYard[];
  tone?: YardListTone;
}) {
  const colours = TONES[tone];
  return (
    <div>
      <div
        aria-hidden="true"
        className={cn(
          "hidden gap-x-6 border-b-2 px-2 pb-2 text-sm font-medium sm:grid",
          TRACKS,
          colours.rule,
          colours.head,
        )}
      >
        <span>Yard</span>
        <span>City</span>
        <span className="text-right">Vehicles</span>
      </div>
      <ul className={cn("border-t-2 sm:border-t-0", colours.rule)}>
        {yards.map((yard) => (
          <li key={yard.path.href} className={cn("border-b", colours.row)}>
            <Link
              href={yard.path.href}
              prefetch={false}
              className={cn(
                "group board-step grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-0.5 px-2 py-3.5 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid",
                TRACKS,
                colours.link,
              )}
            >
              <span
                className={cn(
                  "board-step col-start-1 row-start-1 text-[0.9375rem] leading-snug font-extrabold",
                  colours.name,
                )}
              >
                {YardName.headline(yard.name, yard.operator)}
              </span>
              <span
                className={cn(
                  "col-start-1 row-start-2 truncate text-sm sm:col-start-2 sm:row-start-1",
                  colours.meta,
                )}
              >
                {yard.city}, {yard.state}
              </span>
              <span
                className={cn(
                  "col-start-2 row-span-2 row-start-1 text-right text-lg leading-tight font-extrabold tabular-nums sm:col-start-3 sm:row-span-1",
                  colours.figure,
                )}
              >
                {InventoryFormat.count(yard.vehicleCount)}
                <span
                  className={cn(
                    "block text-sm font-normal sm:sr-only",
                    colours.meta,
                  )}
                >
                  {" "}
                  {yard.vehicleCount === 1 ? "vehicle" : "vehicles"}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

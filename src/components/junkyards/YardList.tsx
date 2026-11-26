import { YardService } from "~/lib/yard-service";
import { isIngestionSource } from "~/lib/ingestion-source";
import Link from "next/link";
import { InventoryFormat } from "~/lib/inventory-format";
import {
  InventoryStaleness,
  type InventoryCheckDates,
} from "~/lib/inventory-staleness";
import { cn } from "~/lib/utils";
import { YardName } from "~/lib/yard-name";
import type { RoutedYard } from "~/server/yard-inventory";

/** The surface the list sits on: the paper, or the ink board where figures take the figure colour. */
type YardListTone = "paper" | "board";

const TONES = {
  paper: {
    rule: "border-rule-strong",
    head: "text-ink-3",
    row: "border-rule",
    link: "hover:bg-paper-2 active:bg-paper-2 focus-visible:outline-focus",
    name: "text-ink group-hover/row:text-signal",
    meta: "text-ink-3",
    stale: "border-warning text-warning",
    figure: "text-ink",
  },
  board: {
    rule: "border-board-rule",
    head: "text-board-muted",
    row: "border-board-rule",
    link: "hover:bg-board-2 active:bg-board-2 focus-visible:outline-figure",
    name: "text-board-ink",
    meta: "text-board-muted",
    stale: "border-board-warning text-board-warning",
    figure: "text-figure",
  },
} as const satisfies Record<YardListTone, Record<string, string>>;

/**
 * Links to yards' inventory pages as an index: the yard, its city and its
 * live count in columns, under one head row. Phones stack the city under
 * the name and say the unit beside the figure.
 */
export function YardList({
  yards,
  checkDates,
  tone = "paper",
}: {
  yards: readonly RoutedYard[];
  /** When each yard was last checked; a stale yard says so. */
  checkDates: InventoryCheckDates;
  tone?: YardListTone;
}) {
  const colours = TONES[tone];
  const now = Date.now();
  return (
    <div>
      <div
        aria-hidden="true"
        className={cn(
          // Name, city, count: the same three tracks as every row.
          "yard-list-tracks hidden gap-x-6 border-b px-2 pb-2 text-sm font-medium sm:grid",
          colours.rule,
          colours.head,
        )}
      >
        <span>Yard</span>
        <span>City</span>
        <span className="text-right">Vehicles</span>
      </div>
      <ul className={cn("border-t sm:border-t-0", colours.rule)}>
        {yards.map((yard) => {
          const lastChecked = InventoryStaleness.labelFor(
            checkDates,
            yard.source,
            yard.code,
            now,
          );
          return (
            <li key={yard.path.href} className={cn("border-b", colours.row)}>
              <Link
                href={yard.path.href}
                prefetch={false}
                // The row classes are in globals.css: a list can hold every yard.
                className={cn("group/row yard-list-link", colours.link)}
              >
                <span className={cn("yard-list-name", colours.name)}>
                  {YardName.headline(yard.name, yard.operator)}
                  {isIngestionSource(yard.source) && (
                    <span className={cn("yard-list-service", colours.meta)}>
                      {YardService.label(
                        YardService.resolve(yard.source, yard.code),
                      )}
                    </span>
                  )}
                  {lastChecked && (
                    <span
                      className={cn(
                        "mt-1 inline-block border px-1.5 py-0.5 text-xs font-medium",
                        colours.stale,
                      )}
                    >
                      {lastChecked}
                    </span>
                  )}
                </span>
                <span className={cn("yard-list-place", colours.meta)}>
                  {yard.city}, {yard.state}
                </span>
                <span className={cn("yard-list-figure", colours.figure)}>
                  {InventoryFormat.count(yard.vehicleCount)}
                  <span className={cn("yard-list-unit", colours.meta)}>
                    {" "}
                    {yard.vehicleCount === 1 ? "vehicle" : "vehicles"}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

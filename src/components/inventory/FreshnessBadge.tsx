import { InventoryFormat } from "~/lib/inventory-format";
import { cn } from "~/lib/utils";

/**
 * When the inventory on a page was last updated. A date when the source
 * refreshed in the last 3 days; otherwise a plain warning, so a stale feed is
 * never shown as current. With `coverage`, a page listing several yards also
 * says how many of them are current, rather than only the newest date.
 *
 * The square is the live state: filled cobalt when every yard is current,
 * outlined cobalt when only some are. A stale feed is Wayfind's late row,
 * an amber fill under ink text.
 */
export function FreshnessBadge({
  publishedAt,
  coverage,
}: {
  publishedAt: string | null;
  coverage?: { current: number; total: number };
}) {
  if (publishedAt === null) {
    return (
      <p className="bg-figure text-board inline-block px-2.5 py-1 text-sm font-extrabold text-pretty">
        Not updated in the last 3 days, so some listings may be gone.
      </p>
    );
  }
  const partial = coverage && coverage.current < coverage.total;
  return (
    <p className="text-ink-2 flex flex-wrap items-center gap-x-2.5 text-sm">
      <span
        className={cn(
          "size-2.5 shrink-0",
          partial ? "border-signal border-2" : "bg-signal",
        )}
        aria-hidden="true"
      />
      <span>
        Updated{" "}
        <time dateTime={publishedAt} className="text-ink">
          {InventoryFormat.date(publishedAt)}
        </time>
        {partial && (
          <>
            {" "}
            ({InventoryFormat.count(coverage.current)} of{" "}
            {InventoryFormat.count(coverage.total)} yards current)
          </>
        )}
      </span>
    </p>
  );
}

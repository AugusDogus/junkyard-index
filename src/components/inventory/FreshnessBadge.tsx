import { InventoryFormat } from "~/lib/inventory-format";
import { InventoryStaleness } from "~/lib/inventory-staleness";
import { cn } from "~/lib/utils";

/**
 * When the inventory on a page was last updated. A date when the source
 * refreshed within INVENTORY_STALE_AFTER_HOURS; when it was last checked for
 * a known older publication, and a neutral label when untracked. With `coverage`, a page listing several
 * yards also says how many are current, rather than only the newest date.
 *
 * The square is the live state: filled in the accent when every yard is
 * current, outlined when only some are. A stale feed is a late row: muted
 * amber text in an amber outline, so it never reads as the live mark.
 */
export function FreshnessBadge({
  publishedAt,
  coverage,
}: {
  publishedAt: string | null;
  coverage?: { current: number; total: number };
}) {
  if (publishedAt === null) {
    return <p className="text-ink-2 text-sm">Update time unknown</p>;
  }
  const stale = InventoryStaleness.label(publishedAt, Date.now());
  if (stale !== null) {
    return (
      <p className="border-warning text-warning inline-block border px-2.5 py-1 text-sm font-medium text-pretty">
        {stale}, so some listings may be gone.
      </p>
    );
  }
  const partial = coverage && coverage.current < coverage.total;
  return (
    <p className="text-ink-2 flex items-center gap-x-2.5 text-sm">
      <span
        className={cn(
          "size-2.5 shrink-0",
          partial ? "border-signal border" : "bg-signal",
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

import { InventoryFormat } from "~/lib/inventory-format";
import { cn } from "~/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_STALE_AFTER_MS = 3 * DAY_MS;

/**
 * When the inventory on a page was last updated. A date when the source
 * refreshed within `staleAfterMs` (3 days unless given: a daily source's
 * publication look-back); a warning for a known older publication, and a
 * neutral label when untracked. A single yard's page passes its source's
 * `sourcePublicationLookbackMs`, computed on the server, so a source crawled
 * less often than daily does not warn between crawls. With `coverage`, a page
 * listing several yards also says how many are current, rather than only the
 * newest date.
 *
 * The square is the live state: filled cobalt when every yard is current,
 * outlined cobalt when only some are. A stale feed is Wayfind's late row,
 * an amber fill under ink text.
 */
export function FreshnessBadge({
  publishedAt,
  coverage,
  staleAfterMs = DAILY_STALE_AFTER_MS,
}: {
  publishedAt: string | null;
  coverage?: { current: number; total: number };
  staleAfterMs?: number;
}) {
  if (publishedAt === null) {
    return <p className="text-ink-2 text-sm">Update time unknown</p>;
  }
  if (Date.now() - Date.parse(publishedAt) > staleAfterMs) {
    return (
      <p className="bg-figure text-board inline-block px-2.5 py-1 text-sm font-extrabold text-pretty">
        {`Not updated in the last ${Math.round(staleAfterMs / DAY_MS)} days, so some listings may be gone.`}
      </p>
    );
  }
  const partial = coverage && coverage.current < coverage.total;
  return (
    <p className="text-ink-2 flex items-center gap-x-2.5 text-sm">
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

import { InventoryFormat } from "~/lib/inventory-format";

/**
 * When the inventory on a page was last updated. A date when the source
 * refreshed in the last 3 days; otherwise a plain warning, so a stale feed is
 * never shown as current.
 */
export function FreshnessBadge({
  publishedAt,
}: {
  publishedAt: string | null;
}) {
  if (publishedAt === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
        <span
          className="size-2 shrink-0 rounded-full bg-amber-500"
          aria-hidden="true"
        />
        Not updated in the last 3 days, so some listings may be gone.
      </p>
    );
  }
  return (
    <p className="text-muted-foreground flex items-center gap-2 text-sm">
      <span
        className="size-2 shrink-0 rounded-full bg-emerald-500"
        aria-hidden="true"
      />
      <span>
        Updated{" "}
        <time dateTime={publishedAt}>{InventoryFormat.date(publishedAt)}</time>
      </span>
    </p>
  );
}

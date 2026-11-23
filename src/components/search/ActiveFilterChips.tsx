import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { ActiveSearchFilter } from "./active-search-filters";

/** One row of removable chips for the non-default choices, plus Clear all. */
export function ActiveFilterChips({
  filters,
  onRemove,
  onClearAll,
  notice,
}: {
  filters: ActiveSearchFilter[];
  onRemove(filter: ActiveSearchFilter): void;
  onClearAll(): void;
  /** A note about the filters, such as a radius still waiting for a location. */
  notice?: ReactNode;
}) {
  if (filters.length === 0 && !notice) return null;
  return (
    <div className="flex flex-col gap-2 pb-1">
      {filters.length > 0 && (
        <div
          role="group"
          aria-label="Active filters"
          className="flex flex-wrap items-center gap-x-2 gap-y-2.5"
        >
          {filters.map((filter) => {
            const label = ActiveSearchFilter.label(filter);
            return (
              <button
                key={filter.kind}
                type="button"
                aria-label={`Remove ${label}`}
                onClick={() => onRemove(filter)}
                // The 32px chip keeps a 44px touch target on phones.
                className="border-border hover:border-foreground focus-visible:outline-focus relative inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium tabular-nums transition-[border-color,transform] duration-150 ease-out after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.97] sm:after:hidden"
              >
                <span className="truncate">{label}</span>
                <X
                  aria-hidden="true"
                  className="text-muted-foreground size-3.5"
                />
              </button>
            );
          })}
          {/* One chip clears with its own x. Phones clear all from the
              Filters drawer, so the chips keep to one line above results. */}
          {filters.length > 1 && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="text-muted-foreground hover:text-foreground hidden h-8 px-0 text-xs sm:inline-flex"
              onClick={onClearAll}
            >
              Clear all
            </Button>
          )}
        </div>
      )}
      {notice}
    </div>
  );
}

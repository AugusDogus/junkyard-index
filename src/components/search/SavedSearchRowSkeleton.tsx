import { Skeleton } from "~/components/ui/skeleton";
import "./saved-search-row.css";

export function SavedSearchRowSkeleton() {
  return (
    <div className="saved-search-row" aria-hidden="true">
      <div className="saved-search-row-main">
        <Skeleton className="saved-search-row-icon" />
        <div className="min-w-0 flex-1">
          <div className="flex h-6 items-center">
            <Skeleton className="h-4 w-36 max-w-full" />
          </div>
          <div className="mt-2 flex h-5 items-center">
            <Skeleton className="h-3 w-52 max-w-full" />
          </div>
        </div>
        <Skeleton className="saved-search-row-arrow size-4" />
      </div>
      <div className="saved-search-row-actions">
        {[0, 1].map((index) => (
          <div
            key={index}
            className="flex size-11 shrink-0 items-center justify-center"
          >
            <Skeleton className="size-5 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

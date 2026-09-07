"use client";

import { Bookmark, Lock } from "lucide-react";
import Link from "next/link";
import { SavedSearchRow } from "~/components/search/SavedSearchRow";
import { SavedSearchUpgradeNotice } from "~/components/search/SavedSearchUpgradeNotice";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { SavedSearchRowSkeleton } from "~/components/search/SavedSearchRowSkeleton";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

interface SavedSearchesListProps {
  locked: boolean;
  className?: string;
}

export function SavedSearchesList({
  locked,
  className,
}: SavedSearchesListProps) {
  const { data: savedSearches, isLoading } = api.savedSearches.list.useQuery();
  const searchCount = savedSearches?.length ?? 0;

  return (
    <section aria-label="Saved searches" className={cn("min-w-0", className)}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-balance">
          Saved searches
          {!isLoading && <Badge variant="secondary">{searchCount}</Badge>}
        </h2>
        <Button asChild variant="ghost" size="sm" className="min-h-11">
          <Link href="/settings/searches">Manage</Link>
        </Button>
      </div>
      {locked && searchCount > 0 && (
        <SavedSearchUpgradeNotice className="m-4 sm:m-5" />
      )}

      {isLoading && (
        <div
          aria-label="Loading saved searches"
          role="status"
          className="grid gap-2.5"
        >
          {[0, 1, 2].map((index) => (
            <SavedSearchRowSkeleton key={index} />
          ))}
        </div>
      )}

      {!isLoading && searchCount === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {locked ? <Lock /> : <Bookmark />}
            </EmptyMedia>
            <EmptyTitle>No saved searches yet</EmptyTitle>
            <EmptyDescription>
              {locked
                ? "Lite saves the exact query and filters so you can return to a parts hunt in one click."
                : "Run a search, add the filters you need, then choose Save search from the results toolbar."}
            </EmptyDescription>
          </EmptyHeader>
          {locked && (
            <EmptyContent>
              <Button asChild size="sm">
                <Link href="/pricing">View Lite</Link>
              </Button>
            </EmptyContent>
          )}
        </Empty>
      )}

      {!isLoading && savedSearches && savedSearches.length > 0 && (
        <div className="grid gap-2.5">
          {savedSearches.map((search) => (
            <SavedSearchRow
              key={search.id}
              search={search}
              locked={locked}
              source="saved_searches_list"
            />
          ))}
        </div>
      )}
    </section>
  );
}

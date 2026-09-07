"use client";

import Link from "next/link";
import { SavedSearchRow } from "~/components/search/SavedSearchRow";
import { SavedSearchUpgradeNotice } from "~/components/search/SavedSearchUpgradeNotice";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { SavedSearchRowSkeleton } from "~/components/search/SavedSearchRowSkeleton";
import { usePlanAccess } from "~/hooks/use-plan-access";
import { resolveClientPlanFeatureAccess } from "~/lib/client-plan-feature-access";
import { api } from "~/trpc/react";

export function SavedSearchSettingsCard() {
  const { data: searches, isLoading } = api.savedSearches.list.useQuery();
  const planAccess = usePlanAccess(true);
  const savedSearchesLocked = !resolveClientPlanFeatureAccess({
    access: planAccess,
    feature: "saved_searches",
  });
  const searchCount = searches?.length ?? 0;

  return (
    <section aria-labelledby="saved-searches-heading">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2">
        <h2
          id="saved-searches-heading"
          className="text-xl font-semibold text-balance"
        >
          Saved searches
        </h2>
        <Button asChild variant="outline" size="sm" className="min-h-11">
          <Link href="/search?advanced=1">New search</Link>
        </Button>
      </div>

      <div className="mt-6">
        {isLoading && (
          <div
            aria-label="Loading saved searches"
            role="status"
            className="grid gap-2.5"
          >
            {[0, 1].map((index) => (
              <SavedSearchRowSkeleton key={index} />
            ))}
          </div>
        )}

        {!isLoading && searchCount === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No saved searches yet</EmptyTitle>
              <EmptyDescription>
                Save a search when you want to revisit the same vehicle and
                filters later.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild variant="outline" size="sm">
                <Link href="/search?advanced=1">Create a search</Link>
              </Button>
            </EmptyContent>
          </Empty>
        )}

        {!isLoading && searches && searches.length > 0 && (
          <div>
            {savedSearchesLocked && (
              <SavedSearchUpgradeNotice className="mb-5" />
            )}
            <div className="grid gap-2.5">
              {searches.map((search) => (
                <SavedSearchRow
                  key={search.id}
                  search={search}
                  locked={savedSearchesLocked}
                  source="settings"
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

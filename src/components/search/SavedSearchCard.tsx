"use client";

import { useId } from "react";
import Link from "next/link";
import { DeleteSavedSearchDialog } from "~/components/search/DeleteSavedSearchDialog";
import { SavedSearchAlerts } from "~/components/search/SavedSearchAlerts";
import { SavedSearchCriteria } from "~/components/search/SavedSearchCriteria";
import { EditSavedSearchDialog } from "~/components/settings/EditSavedSearchDialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { buildSearchUrl } from "~/lib/search-utils";
import type { RouterOutputs } from "~/trpc/react";

type SavedSearch = RouterOutputs["savedSearches"]["list"][number];

export function SavedSearchCard({
  search,
  locked,
  source,
  deleting,
  togglingAlerts,
  onDelete,
  onEmailChange,
  onDiscordChange,
}: {
  search: SavedSearch;
  locked: boolean;
  source: "settings" | "saved_searches_list";
  deleting: boolean;
  togglingAlerts: boolean;
  onDelete: () => Promise<unknown>;
  onEmailChange: (enabled: boolean) => void;
  onDiscordChange: (enabled: boolean) => void;
}) {
  const headingId = useId();
  return (
    <article
      aria-labelledby={headingId}
      className="bg-card @container min-w-0 overflow-hidden rounded-xl border"
    >
      <div className="grid @xl:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="flex min-w-0 flex-col items-start gap-4 p-5 sm:p-6">
          <div className="flex w-full min-w-0 items-start gap-2">
            <h3
              id={headingId}
              className="min-w-0 text-lg font-semibold text-balance break-words"
            >
              {search.name}
            </h3>
            {locked && <Badge variant="outline">Locked</Badge>}
          </div>
          <SavedSearchCriteria query={search.query} filters={search.filters} />
          <div className="mt-auto flex flex-wrap items-center gap-1 pt-2">
            {!locked && (
              <>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                >
                  <Link
                    href={buildSearchUrl(search.query, search.filters)}
                    aria-label={`Open saved search ${search.name}`}
                  >
                    Open search
                  </Link>
                </Button>
                <EditSavedSearchDialog search={search} source={source} />
              </>
            )}
            <DeleteSavedSearchDialog
              searchName={search.name}
              disabled={deleting}
              onDelete={onDelete}
            />
          </div>
        </div>
        {locked ? (
          <p className="text-muted-foreground border-t p-5 text-sm sm:p-6 @xl:border-t-0 @xl:border-l">
            Alerts are unavailable on your current plan.
          </p>
        ) : (
          <SavedSearchAlerts
            searchName={search.name}
            emailEnabled={search.emailAlertsEnabled}
            discordEnabled={search.discordAlertsEnabled}
            disabled={togglingAlerts}
            onEmailChange={onEmailChange}
            onDiscordChange={onDiscordChange}
          />
        )}
      </div>
    </article>
  );
}

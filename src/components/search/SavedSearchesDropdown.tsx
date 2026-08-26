"use client";

import { Bookmark, Lock, Search, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { buildSearchUrl } from "~/lib/search-utils";
import { api } from "~/trpc/react";

interface SavedSearchesDropdownProps {
  compact?: boolean;
  iconOnly?: boolean;
  locked?: boolean;
}

export function SavedSearchesDropdown({
  compact,
  iconOnly,
  locked = false,
}: SavedSearchesDropdownProps = {}) {
  const router = useRouter();
  const { data: savedSearches, isLoading } = api.savedSearches.list.useQuery();

  const handleLoadSearch = (search: NonNullable<typeof savedSearches>[0]) => {
    posthog.capture(AnalyticsEvents.SAVED_SEARCH_LOADED, {
      search_id: search.id,
      search_name: search.name,
      query: search.query,
      source: "dropdown",
    });
    router.push(buildSearchUrl(search.query, search.filters));
  };

  if (isLoading) {
    return (
      <Button
        variant="outline"
        size={compact || iconOnly ? "sm" : "default"}
        disabled
      >
        <Bookmark data-icon="inline-start" />
        {!iconOnly && "Saved"}
      </Button>
    );
  }

  if (!savedSearches || savedSearches.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={compact || iconOnly ? "sm" : "default"}
          aria-label={
            iconOnly ? `Open ${savedSearches.length} saved searches` : undefined
          }
        >
          <Bookmark data-icon="inline-start" />
          {iconOnly ? savedSearches.length : `Saved (${savedSearches.length})`}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuLabel>Saved searches</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {locked && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link href="/pricing">
                  <Lock />
                  Upgrade to Lite to reopen these searches
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuGroup>
          {savedSearches.map((search) => (
            <DropdownMenuItem
              key={search.id}
              disabled={locked}
              className="items-start py-2.5"
              onSelect={() => handleLoadSearch(search)}
            >
              <div className="bg-secondary flex size-8 shrink-0 items-center justify-center rounded-md">
                {locked ? <Lock /> : <Search />}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">{search.name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {search.query || search.filters.vinPattern || "All vehicles"}
                </span>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <Settings />
              Manage saved searches
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

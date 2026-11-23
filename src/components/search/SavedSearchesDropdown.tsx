"use client";

import { List, Lock, Search, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Analytics } from "~/lib/analytics";
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
  responsive?: boolean;
  locked?: boolean;
}

export function SavedSearchesDropdown({
  compact,
  iconOnly,
  responsive,
  locked = false,
}: SavedSearchesDropdownProps = {}) {
  const router = useRouter();
  const { data: savedSearches, isLoading } = api.savedSearches.list.useQuery();

  const handleLoadSearch = (search: NonNullable<typeof savedSearches>[0]) => {
    Analytics.capture(AnalyticsEvents.SAVED_SEARCH_LOADED, {
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
        <List data-icon="inline-start" />
        {!iconOnly && (
          <span className={responsive ? "sr-only md:not-sr-only" : undefined}>
            Saved
          </span>
        )}
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
            iconOnly || responsive
              ? `Open ${savedSearches.length} saved searches`
              : undefined
          }
        >
          <List data-icon="inline-start" />
          {iconOnly ? (
            savedSearches.length
          ) : responsive ? (
            // Phones keep the count visible beside the icon.
            <>
              <span className="tabular-nums md:hidden">
                {savedSearches.length}
              </span>
              <span className="hidden md:inline">{`Saved (${savedSearches.length})`}</span>
            </>
          ) : (
            `Saved (${savedSearches.length})`
          )}
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
                  {search.filters.expression ||
                    search.query ||
                    search.filters.vinPattern ||
                    "All vehicles"}
                </span>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/settings/searches">
              <Settings />
              Manage saved searches
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

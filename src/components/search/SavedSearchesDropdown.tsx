"use client";

import { BookmarkCheck, FolderOpen, Lock, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import posthog from "posthog-js";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { buildSearchUrl } from "~/lib/search-utils";
import { api } from "~/trpc/react";
import { SavedSearchUpgradeNotice } from "./SavedSearchUpgradeNotice";

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
  const utils = api.useUtils();

  const { data: savedSearches, isLoading } = api.savedSearches.list.useQuery();

  const deleteMutation = api.savedSearches.delete.useMutation({
    onMutate: async ({ id }) => {
      // Cancel outgoing refetches
      await utils.savedSearches.list.cancel();

      // Snapshot current data
      const previousSearches = utils.savedSearches.list.getData();

      // Optimistically remove the item
      utils.savedSearches.list.setData(undefined, (old) =>
        old?.filter((search) => search.id !== id),
      );

      return { previousSearches };
    },
    onError: (error, _variables, context) => {
      // Rollback on error
      if (context?.previousSearches) {
        utils.savedSearches.list.setData(undefined, context.previousSearches);
      }
      toast.error(error.message || "Failed to delete search");
    },
    onSuccess: () => {
      toast.success("Search deleted");
    },
    onSettled: () => {
      // Refetch to ensure consistency
      void utils.savedSearches.list.invalidate();
    },
  });

  const handleLoadSearch = (search: NonNullable<typeof savedSearches>[0]) => {
    posthog.capture(AnalyticsEvents.SAVED_SEARCH_LOADED, {
      search_id: search.id,
      search_name: search.name,
      query: search.query,
      source: "dropdown",
    });
    router.push(buildSearchUrl(search.query, search.filters));
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    posthog.capture(AnalyticsEvents.SAVED_SEARCH_DELETED, {
      search_id: id,
      source: "dropdown",
    });
    deleteMutation.mutate({ id });
  };

  if (isLoading) {
    return (
      <Button
        variant="outline"
        size={compact || iconOnly ? "sm" : "default"}
        className={compact || iconOnly ? "h-8 text-xs" : ""}
        disabled
      >
        <FolderOpen
          className={compact || iconOnly ? "h-3.5 w-3.5" : "h-4 w-4"}
        />
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
          className={compact || iconOnly ? "h-8 text-xs" : ""}
        >
          <BookmarkCheck
            className={compact || iconOnly ? "h-3.5 w-3.5" : "h-4 w-4"}
          />
          {iconOnly ? savedSearches.length : `Saved (${savedSearches.length})`}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Saved Searches</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {locked && (
          <SavedSearchUpgradeNotice
            compact
            className="m-2 border-0 p-3 shadow-none"
          />
        )}
        {savedSearches.map((search) => (
          <DropdownMenuItem
            key={search.id}
            className={
              locked
                ? "flex cursor-default items-center justify-between"
                : "flex cursor-pointer items-center justify-between"
            }
            onSelect={(event) => {
              if (locked) {
                event.preventDefault();
                return;
              }
              handleLoadSearch(search);
            }}
          >
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">{search.name}</span>
              <span className="text-muted-foreground text-xs">
                {search.query || search.filters.vinPattern || "All vehicles"}
              </span>
            </div>
            {locked && <Lock className="text-muted-foreground ml-2 size-3" />}
            <Button
              variant="ghost"
              size="sm"
              className="hover:bg-destructive hover:text-destructive-foreground h-6 w-6 p-0"
              onClick={(e) => handleDelete(e, search.id)}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

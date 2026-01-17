"use client";

import { BookmarkCheck, FolderOpen, Trash2 } from "lucide-react";
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
import { buildSearchUrl } from "~/lib/search-utils";
import { api } from "~/trpc/react";

interface SavedSearchesDropdownProps {
  compact?: boolean;
  iconOnly?: boolean;
}

export function SavedSearchesDropdown({ compact, iconOnly }: SavedSearchesDropdownProps = {}) {
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
        old?.filter((search) => search.id !== id)
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
    router.push(buildSearchUrl(search.query, search.filters));
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteMutation.mutate({ id });
  };

  if (isLoading) {
    return (
      <Button variant="outline" size={compact || iconOnly ? "sm" : "default"} className={compact || iconOnly ? "h-8 text-xs" : ""} disabled>
        <FolderOpen className={compact || iconOnly ? "h-3.5 w-3.5" : "h-4 w-4"} />
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
        <Button variant="outline" size={compact || iconOnly ? "sm" : "default"} className={compact || iconOnly ? "h-8 text-xs" : ""}>
          <BookmarkCheck className={compact || iconOnly ? "h-3.5 w-3.5" : "h-4 w-4"} />
          {iconOnly ? savedSearches.length : `Saved (${savedSearches.length})`}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Saved Searches</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {savedSearches.map((search) => (
          <DropdownMenuItem
            key={search.id}
            className="flex cursor-pointer items-center justify-between"
            onClick={() => handleLoadSearch(search)}
          >
            <div className="flex flex-col">
              <span className="font-medium">{search.name}</span>
              <span className="text-muted-foreground text-xs">
                {search.query || "No query"}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 hover:bg-destructive hover:text-destructive-foreground"
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

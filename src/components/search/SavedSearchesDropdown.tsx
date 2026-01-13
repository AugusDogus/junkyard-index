"use client";

import { useRouter } from "next/navigation";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { BookmarkCheck, Trash2, FolderOpen } from "lucide-react";
import { api } from "~/trpc/react";
import { toast } from "sonner";

export function SavedSearchesDropdown() {
  const router = useRouter();
  const utils = api.useUtils();

  const { data: savedSearches, isLoading } = api.savedSearches.list.useQuery();

  const deleteMutation = api.savedSearches.delete.useMutation({
    onSuccess: () => {
      toast.success("Search deleted");
      void utils.savedSearches.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete search");
    },
  });

  const handleLoadSearch = (search: NonNullable<typeof savedSearches>[0]) => {
    const params = new URLSearchParams();

    if (search.query) {
      params.set("q", search.query);
    }

    const filters = search.filters;
    if (filters.makes && filters.makes.length > 0) {
      params.set("makes", filters.makes.join(","));
    }
    if (filters.colors && filters.colors.length > 0) {
      params.set("colors", filters.colors.join(","));
    }
    if (filters.states && filters.states.length > 0) {
      params.set("states", filters.states.join(","));
    }
    if (filters.salvageYards && filters.salvageYards.length > 0) {
      params.set("yards", filters.salvageYards.join(","));
    }
    if (filters.minYear) {
      params.set("minYear", filters.minYear.toString());
    }
    if (filters.maxYear) {
      params.set("maxYear", filters.maxYear.toString());
    }
    if (filters.sortBy) {
      params.set("sort", filters.sortBy);
    }

    router.push(`/search?${params.toString()}`);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteMutation.mutate({ id });
  };

  if (isLoading) {
    return (
      <Button variant="outline" size="sm" disabled>
        <FolderOpen className="mr-2 h-4 w-4" />
        Saved
      </Button>
    );
  }

  if (!savedSearches || savedSearches.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <BookmarkCheck className="mr-2 h-4 w-4" />
          Saved ({savedSearches.length})
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

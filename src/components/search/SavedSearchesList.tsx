"use client";

import { useRouter } from "next/navigation";
import { Bookmark, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { api } from "~/trpc/react";
import { toast } from "sonner";
import { buildSearchUrl } from "~/lib/search-utils";
import { useIsMobile } from "~/hooks/use-media-query";

export function SavedSearchesList() {
  const router = useRouter();
  const utils = api.useUtils();
  const isMobile = useIsMobile();

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
    router.push(buildSearchUrl(search.query, search.filters));
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteMutation.mutate({ id });
  };

  if (isLoading) {
    return (
      <div className="mt-8">
        <h3 className="text-muted-foreground mb-4 text-sm font-medium">Your Saved Searches</h3>
        <div className={`grid gap-3 ${isMobile ? "" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className={isMobile ? "p-5" : "p-4"}>
                <div className="bg-muted h-4 w-24 rounded" />
                <div className="bg-muted mt-2 h-3 w-16 rounded" />
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!savedSearches || savedSearches.length === 0) {
    return null;
  }

  return (
    <div className="mt-8">
      <h3 className="text-muted-foreground mb-4 text-sm font-medium">Your Saved Searches</h3>
      <div className={`grid gap-3 ${isMobile ? "" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
        {savedSearches.map((search) => (
          <Card
            key={search.id}
            className="group cursor-pointer transition-colors hover:bg-accent"
            onClick={() => handleLoadSearch(search)}
          >
            <CardHeader className={isMobile ? "p-5" : "p-4"}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Bookmark className="text-muted-foreground h-4 w-4 shrink-0" />
                  <CardTitle className="text-sm font-medium truncate">{search.name}</CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-8 w-8 shrink-0 p-0 transition-opacity hover:bg-destructive hover:text-destructive-foreground ${
                    isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  onClick={(e) => handleDelete(e, search.id)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <CardDescription className={`${isMobile ? "text-sm" : "text-xs"}`}>
                {search.query || "No query"}
                {search.filters.makes?.length ? ` · ${search.filters.makes.join(", ")}` : ""}
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}

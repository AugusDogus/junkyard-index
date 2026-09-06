"use client";

import {
  Bookmark,
  Lock,
  MoreHorizontal,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import { toast } from "sonner";
import { SavedSearchAlerts } from "~/components/search/SavedSearchAlerts";
import { SavedSearchUpgradeNotice } from "~/components/search/SavedSearchUpgradeNotice";
import { EditSavedSearchDialog } from "~/components/settings/EditSavedSearchDialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import { useAlertSubscriptionAccess } from "~/hooks/use-alert-subscription-access";
import { AnalyticsEvents } from "~/lib/analytics-events";
import type { SavedSearchFilters } from "~/lib/saved-search-filters";
import { buildSearchUrl } from "~/lib/search-utils";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

interface SavedSearchesListProps {
  locked: boolean;
  className?: string;
}

function summarizeValues(values: readonly string[], label: string): string {
  if (values.length === 1) {
    return values[0] ?? label;
  }

  if (values.length === 2) {
    return values.join(", ");
  }

  return `${values[0] ?? label} +${values.length - 1}`;
}

function getFilterLabels(filters: SavedSearchFilters): string[] {
  const labels: string[] = [];

  if (filters.makes?.length) {
    labels.push(summarizeValues(filters.makes, "Makes"));
  }
  if (filters.states?.length) {
    labels.push(summarizeValues(filters.states, "States"));
  }
  if (filters.minYear || filters.maxYear) {
    labels.push(
      filters.minYear && filters.maxYear
        ? `${filters.minYear}-${filters.maxYear}`
        : filters.minYear
          ? `${filters.minYear}+`
          : `Through ${filters.maxYear}`,
    );
  }
  if (filters.colors?.length) {
    labels.push(summarizeValues(filters.colors, "Colors"));
  }
  if (filters.salvageYards?.length) {
    labels.push(
      `${filters.salvageYards.length} ${filters.salvageYards.length === 1 ? "yard" : "yards"}`,
    );
  }
  if (filters.sources?.length) {
    labels.push(
      `${filters.sources.length} ${filters.sources.length === 1 ? "source" : "sources"}`,
    );
  }

  if (labels.length <= 3) {
    return labels;
  }

  return [...labels.slice(0, 3), `+${labels.length - 3}`];
}

export function SavedSearchesList({
  locked,
  className,
}: SavedSearchesListProps) {
  const utils = api.useUtils();
  const { data: savedSearches, isLoading } = api.savedSearches.list.useQuery();
  const { data: notificationSettings } =
    api.user.getNotificationSettings.useQuery();
  const { canAttemptAlertInteraction, openAlertUpgrade } =
    useAlertSubscriptionAccess("saved_searches_list");
  const canUseDiscord =
    notificationSettings?.hasDiscordLinked &&
    notificationSettings?.discordAppInstalled;

  const deleteMutation = api.savedSearches.delete.useMutation({
    onMutate: async ({ id }) => {
      await utils.savedSearches.list.cancel();
      const previousSearches = utils.savedSearches.list.getData();
      utils.savedSearches.list.setData(undefined, (old) =>
        old?.filter((search) => search.id !== id),
      );
      return { previousSearches };
    },
    onError: (error, _variables, context) => {
      if (context?.previousSearches) {
        utils.savedSearches.list.setData(undefined, context.previousSearches);
      }
      toast.error(error.message || "Failed to delete search");
    },
    onSuccess: () => {
      toast.success("Search deleted");
    },
    onSettled: () => {
      void utils.savedSearches.list.invalidate();
    },
  });

  const toggleEmailAlertsMutation =
    api.savedSearches.toggleEmailAlerts.useMutation({
      onMutate: async ({ id, enabled }) => {
        await utils.savedSearches.list.cancel();
        const previousSearches = utils.savedSearches.list.getData();
        utils.savedSearches.list.setData(undefined, (old) =>
          old?.map((search) =>
            search.id === id
              ? { ...search, emailAlertsEnabled: enabled }
              : search,
          ),
        );
        return { previousSearches };
      },
      onError: (error, _variables, context) => {
        if (context?.previousSearches) {
          utils.savedSearches.list.setData(undefined, context.previousSearches);
        }
        toast.error(error.message || "Failed to toggle email alerts");
      },
      onSuccess: (_, variables) => {
        toast.success(
          variables.enabled
            ? "Email alerts enabled for this search"
            : "Email alerts disabled for this search",
        );
      },
      onSettled: () => {
        void utils.savedSearches.list.invalidate();
      },
    });

  const toggleDiscordAlertsMutation =
    api.savedSearches.toggleDiscordAlerts.useMutation({
      onMutate: async ({ id, enabled }) => {
        await utils.savedSearches.list.cancel();
        const previousSearches = utils.savedSearches.list.getData();
        utils.savedSearches.list.setData(undefined, (old) =>
          old?.map((search) =>
            search.id === id
              ? { ...search, discordAlertsEnabled: enabled }
              : search,
          ),
        );
        return { previousSearches };
      },
      onError: (error, _variables, context) => {
        if (context?.previousSearches) {
          utils.savedSearches.list.setData(undefined, context.previousSearches);
        }
        toast.error(error.message || "Failed to toggle Discord alerts");
      },
      onSuccess: (_, variables) => {
        toast.success(
          variables.enabled
            ? "Discord alerts enabled for this search"
            : "Discord alerts disabled for this search",
        );
      },
      onSettled: () => {
        void utils.savedSearches.list.invalidate();
      },
    });

  const handleDelete = (id: string) => {
    posthog.capture(AnalyticsEvents.SAVED_SEARCH_DELETED, {
      search_id: id,
      source: "saved_searches_list",
    });
    deleteMutation.mutate({ id });
  };

  const handleToggleEmailAlerts = (searchId: string, enabled: boolean) => {
    if (enabled && !canAttemptAlertInteraction) {
      void openAlertUpgrade();
      return;
    }

    posthog.capture(AnalyticsEvents.SAVED_SEARCH_EMAIL_TOGGLED, {
      search_id: searchId,
      enabled,
    });
    toggleEmailAlertsMutation.mutate({
      id: searchId,
      enabled,
    });
  };

  const handleToggleDiscordAlerts = (searchId: string, enabled: boolean) => {
    if (enabled && !canAttemptAlertInteraction) {
      void openAlertUpgrade();
      return;
    }

    if (enabled && !canUseDiscord) {
      toast.error("Set up Discord notifications in Settings first");
      return;
    }

    posthog.capture(AnalyticsEvents.SAVED_SEARCH_DISCORD_TOGGLED, {
      search_id: searchId,
      enabled,
    });
    toggleDiscordAlertsMutation.mutate({
      id: searchId,
      enabled,
    });
  };

  const searchCount = savedSearches?.length ?? 0;

  return (
    <Card className={cn("gap-0 overflow-hidden py-0", className)}>
      <CardHeader className="border-b py-5">
        <div className="flex items-center gap-3">
          <div className="bg-secondary flex size-9 items-center justify-center rounded-lg">
            <Bookmark aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <CardTitle>Saved searches</CardTitle>
              {!isLoading && <Badge variant="secondary">{searchCount}</Badge>}
            </div>
            <CardDescription>
              {searchCount === 0
                ? "Keep repeat parts hunts within reach."
                : "Reopen a search with every filter intact."}
            </CardDescription>
          </div>
        </div>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href="/settings/searches">
              <Settings data-icon="inline-start" />
              <span className="hidden sm:inline">Manage</span>
              <span className="sr-only sm:hidden">Manage saved searches</span>
            </Link>
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="p-0">
        {locked && searchCount > 0 && (
          <SavedSearchUpgradeNotice className="m-4 sm:m-5" />
        )}

        {isLoading && (
          <div aria-label="Loading saved searches">
            {[0, 1, 2].map((index) => (
              <div key={index}>
                {index > 0 && <Separator />}
                <div className="flex items-center gap-3 px-4 py-5 sm:px-6">
                  <Skeleton className="size-10 shrink-0 rounded-lg" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-52 max-w-full" />
                  </div>
                  <Skeleton className="h-8 w-20" />
                </div>
              </div>
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
          <div>
            {savedSearches.map((search, index) => {
              const filterLabels = getFilterLabels(search.filters);
              const hasEmail = search.emailAlertsEnabled;
              const hasDiscord = search.discordAlertsEnabled;
              const isMutating =
                toggleEmailAlertsMutation.isPending ||
                toggleDiscordAlertsMutation.isPending;
              const searchLabel =
                search.query || search.filters.vinPattern || "All vehicles";
              const searchContent = (
                <>
                  <div className="bg-secondary flex size-10 shrink-0 items-center justify-center rounded-lg">
                    {locked ? (
                      <Lock aria-hidden="true" />
                    ) : (
                      <Search aria-hidden="true" />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">
                        {search.name}
                      </span>
                      {locked && <Badge variant="outline">Locked</Badge>}
                    </div>
                    <span className="text-muted-foreground truncate text-sm">
                      {searchLabel}
                    </span>
                    {filterLabels.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {filterLabels.map((label) => (
                          <Badge key={label} variant="outline">
                            {label}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              );

              return (
                <div key={search.id}>
                  {index > 0 && <Separator />}
                  <div className="grid gap-4 px-4 py-4 sm:px-6">
                    <div className="flex min-w-0 items-start gap-3">
                      {locked ? (
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          {searchContent}
                        </div>
                      ) : (
                        <Link
                          href={buildSearchUrl(search.query, search.filters)}
                          className="focus-visible:ring-ring flex min-w-0 flex-1 items-start gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-offset-4"
                          aria-label={`Open saved search ${search.name}`}
                        >
                          {searchContent}
                        </Link>
                      )}

                      <div className="flex shrink-0 items-center gap-1">
                        {!locked && (
                          <EditSavedSearchDialog
                            search={search}
                            source="saved_searches_list"
                          />
                        )}

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Actions for saved search ${search.name}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={deleteMutation.isPending}
                                onSelect={() => handleDelete(search.id)}
                              >
                                <Trash2 />
                                Delete saved search
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    {!locked && (
                      <SavedSearchAlerts
                        searchName={search.name}
                        emailEnabled={hasEmail}
                        discordEnabled={hasDiscord}
                        disabled={isMutating}
                        onEmailChange={(enabled) =>
                          handleToggleEmailAlerts(search.id, enabled)
                        }
                        onDiscordChange={(enabled) =>
                          handleToggleDiscordAlerts(search.id, enabled)
                        }
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import {
  Bookmark,
  Lock,
  Mail,
  MoreHorizontal,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import { toast } from "sonner";
import { SavedSearchUpgradeNotice } from "~/components/search/SavedSearchUpgradeNotice";
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
import { DiscordIcon } from "~/components/ui/icons";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
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

  const handleToggleEmailAlerts = (searchId: string, currentState: boolean) => {
    if (!currentState && !canAttemptAlertInteraction) {
      void openAlertUpgrade();
      return;
    }

    posthog.capture(AnalyticsEvents.SAVED_SEARCH_EMAIL_TOGGLED, {
      search_id: searchId,
      enabled: !currentState,
    });
    toggleEmailAlertsMutation.mutate({
      id: searchId,
      enabled: !currentState,
    });
  };

  const handleToggleDiscordAlerts = (
    searchId: string,
    currentState: boolean,
  ) => {
    if (!currentState && !canAttemptAlertInteraction) {
      void openAlertUpgrade();
      return;
    }

    if (!currentState && !canUseDiscord) {
      toast.error("Set up Discord notifications in Settings first");
      return;
    }

    posthog.capture(AnalyticsEvents.SAVED_SEARCH_DISCORD_TOGGLED, {
      search_id: searchId,
      enabled: !currentState,
    });
    toggleDiscordAlertsMutation.mutate({
      id: searchId,
      enabled: !currentState,
    });
  };

  const searchCount = savedSearches?.length ?? 0;

  return (
    <TooltipProvider>
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
                    <div className="hover:bg-muted/40 grid gap-3 px-4 py-4 transition-colors sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6">
                      {locked ? (
                        <div className="flex min-w-0 items-start gap-3">
                          {searchContent}
                        </div>
                      ) : (
                        <Link
                          href={buildSearchUrl(search.query, search.filters)}
                          className="focus-visible:ring-ring flex min-w-0 items-start gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-offset-4"
                          aria-label={`Open saved search ${search.name}`}
                        >
                          {searchContent}
                        </Link>
                      )}

                      <div className="flex items-center justify-end gap-1 pl-13 sm:pl-0">
                        {!locked && (
                          <>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  variant={hasEmail ? "secondary" : "ghost"}
                                  size="sm"
                                  onClick={() =>
                                    handleToggleEmailAlerts(search.id, hasEmail)
                                  }
                                  disabled={isMutating}
                                  aria-pressed={hasEmail}
                                  aria-label={
                                    hasEmail
                                      ? "Disable email alerts for this search"
                                      : canAttemptAlertInteraction
                                        ? "Enable email alerts for this search"
                                        : "Subscribe to enable email alerts"
                                  }
                                >
                                  <Mail />
                                  <span className="hidden lg:inline">
                                    Email
                                  </span>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {hasEmail
                                  ? "Email alerts are on"
                                  : canAttemptAlertInteraction
                                    ? "Turn on email alerts"
                                    : "Subscribe to enable email alerts"}
                              </TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  variant={hasDiscord ? "secondary" : "ghost"}
                                  size="sm"
                                  onClick={() =>
                                    handleToggleDiscordAlerts(
                                      search.id,
                                      hasDiscord,
                                    )
                                  }
                                  disabled={isMutating}
                                  aria-pressed={hasDiscord}
                                  aria-label={
                                    hasDiscord
                                      ? "Disable Discord alerts for this search"
                                      : !canAttemptAlertInteraction
                                        ? "Subscribe to enable Discord alerts"
                                        : !canUseDiscord
                                          ? "Set up Discord to enable alerts"
                                          : "Enable Discord alerts for this search"
                                  }
                                >
                                  <DiscordIcon />
                                  <span className="hidden lg:inline">
                                    Discord
                                  </span>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {hasDiscord
                                  ? "Discord alerts are on"
                                  : !canAttemptAlertInteraction
                                    ? "Subscribe to enable Discord alerts"
                                    : !canUseDiscord
                                      ? "Set up Discord in Settings first"
                                      : "Turn on Discord alerts"}
                              </TooltipContent>
                            </Tooltip>
                          </>
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
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

"use client";

import { ArrowRight, Bookmark, Mail, Search, Settings, Trash2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { DiscordIcon } from "~/components/ui/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { authClient } from "~/lib/auth-client";
import { buildSearchUrl } from "~/lib/search-utils";
import { api } from "~/trpc/react";

export function SavedSearchesList() {
  const utils = api.useUtils();

  const { data: savedSearches, isLoading } = api.savedSearches.list.useQuery();
  const { data: subscriptionData } = api.subscription.getCustomerState.useQuery();
  const { data: notificationSettings } = api.user.getNotificationSettings.useQuery();

  const hasActiveSubscription = subscriptionData?.hasActiveSubscription ?? false;
  const canUseDiscord = notificationSettings?.hasDiscordLinked && notificationSettings?.discordAppInstalled;

  const deleteMutation = api.savedSearches.delete.useMutation({
    onMutate: async ({ id }) => {
      await utils.savedSearches.list.cancel();
      const previousSearches = utils.savedSearches.list.getData();
      utils.savedSearches.list.setData(undefined, (old) =>
        old?.filter((search) => search.id !== id)
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

  const toggleEmailAlertsMutation = api.savedSearches.toggleEmailAlerts.useMutation({
    onMutate: async ({ id, enabled }) => {
      await utils.savedSearches.list.cancel();
      const previousSearches = utils.savedSearches.list.getData();
      utils.savedSearches.list.setData(undefined, (old) =>
        old?.map((search) =>
          search.id === id ? { ...search, emailAlertsEnabled: enabled } : search,
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

  const toggleDiscordAlertsMutation = api.savedSearches.toggleDiscordAlerts.useMutation({
    onMutate: async ({ id, enabled }) => {
      await utils.savedSearches.list.cancel();
      const previousSearches = utils.savedSearches.list.getData();
      utils.savedSearches.list.setData(undefined, (old) =>
        old?.map((search) =>
          search.id === id ? { ...search, discordAlertsEnabled: enabled } : search,
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

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    deleteMutation.mutate({ id });
  };

  const handleToggleEmailAlerts = async (e: React.MouseEvent, searchId: string, currentState: boolean) => {
    e.preventDefault();
    e.stopPropagation();

    // If trying to enable but no subscription, redirect to checkout
    if (!currentState && !hasActiveSubscription) {
      try {
        await authClient.checkout({
          slug: "Email-Notifications",
        });
      } catch (error) {
        toast.error("Failed to open checkout. Please try again.");
        console.error("Checkout error:", error);
      }
      return;
    }

    toggleEmailAlertsMutation.mutate({
      id: searchId,
      enabled: !currentState,
    });
  };

  const handleToggleDiscordAlerts = async (e: React.MouseEvent, searchId: string, currentState: boolean) => {
    e.preventDefault();
    e.stopPropagation();

    // If trying to enable but no subscription, redirect to checkout
    if (!currentState && !hasActiveSubscription) {
      try {
        await authClient.checkout({
          slug: "Email-Notifications",
        });
      } catch (error) {
        toast.error("Failed to open checkout. Please try again.");
        console.error("Checkout error:", error);
      }
      return;
    }

    // If trying to enable but Discord not set up, redirect to settings
    if (!currentState && !canUseDiscord) {
      toast.error("Please set up Discord notifications in Settings first");
      return;
    }

    toggleDiscordAlertsMutation.mutate({
      id: searchId,
      enabled: !currentState,
    });
  };

  // Build a summary of active filters for display
  const getFilterSummary = (search: NonNullable<typeof savedSearches>[0]) => {
    const parts: string[] = [];
    if (search.filters.makes?.length) {
      parts.push(search.filters.makes.slice(0, 2).join(", ") + (search.filters.makes.length > 2 ? "..." : ""));
    }
    if (search.filters.states?.length) {
      parts.push(search.filters.states.slice(0, 2).join(", ") + (search.filters.states.length > 2 ? "..." : ""));
    }
    if (search.filters.minYear || search.filters.maxYear) {
      const yearStr = search.filters.minYear && search.filters.maxYear
        ? `${search.filters.minYear}-${search.filters.maxYear}`
        : search.filters.minYear
        ? `${search.filters.minYear}+`
        : `up to ${search.filters.maxYear}`;
      parts.push(yearStr);
    }
    return parts.join(" · ");
  };

  // Get notification status indicators
  const getNotificationStatus = (search: NonNullable<typeof savedSearches>[0]) => {
    const hasEmail = search.emailAlertsEnabled;
    const hasDiscord = search.discordAlertsEnabled;
    return { hasEmail, hasDiscord, hasAny: hasEmail || hasDiscord };
  };

  if (isLoading) {
    return (
      <div className="mt-8 sm:mt-10">
        <div className="mb-4 flex items-center gap-2">
          <Bookmark className="text-muted-foreground h-4 w-4" />
          <h3 className="text-foreground text-sm font-semibold">Saved Searches</h3>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-muted/50 animate-pulse rounded-lg p-4"
            >
              <div className="bg-muted h-4 w-32 rounded" />
              <div className="bg-muted mt-2 h-3 w-48 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!savedSearches || savedSearches.length === 0) {
    return null;
  }

  return (
    <TooltipProvider>
      <div className="mt-8 sm:mt-10">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bookmark className="text-muted-foreground h-4 w-4" />
            <h3 className="text-foreground text-sm font-semibold">Saved Searches</h3>
          </div>
          <Link href="/settings">
            <Button variant="ghost" size="sm" className="h-7 text-xs">
              <Settings className="mr-1 h-3 w-3" />
              Settings
            </Button>
          </Link>
        </div>
        <div className="space-y-2">
          {savedSearches.map((search) => {
            const filterSummary = getFilterSummary(search);
            const { hasEmail, hasDiscord, hasAny } = getNotificationStatus(search);
            const isMutating = toggleEmailAlertsMutation.isPending || toggleDiscordAlertsMutation.isPending;

            return (
              <Link
                key={search.id}
                href={buildSearchUrl(search.query, search.filters)}
                className="group bg-muted/50 hover:bg-muted flex w-full items-center gap-3 rounded-lg p-4 text-left transition-colors"
              >
                <div className="bg-background flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                  <Search className="text-muted-foreground h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-foreground truncate font-medium">
                    {search.name}
                  </div>
                  <div className="text-muted-foreground truncate text-sm">
                    {search.query || "All vehicles"}
                    {filterSummary && ` · ${filterSummary}`}
                  </div>
                  {/* Notification indicators */}
                  {hasAny && (
                    <div className="mt-1 flex items-center gap-2">
                      {hasEmail && (
                        <span className="flex items-center gap-1 text-xs text-blue-500">
                          <Mail className="h-3 w-3" />
                          Email
                        </span>
                      )}
                      {hasDiscord && (
                        <span className="flex items-center gap-1 text-xs text-[#5865F2]">
                          <DiscordIcon className="h-3 w-3" />
                          Discord
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {/* Email notification toggle */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-8 w-8 p-0 transition-opacity ${
                          hasEmail
                            ? "text-blue-500 opacity-100"
                            : "sm:opacity-0 sm:group-hover:opacity-100"
                        }`}
                        onClick={(e) => handleToggleEmailAlerts(e, search.id, hasEmail)}
                        disabled={isMutating}
                        aria-label={hasEmail ? "Disable email alerts for this search" : hasActiveSubscription ? "Enable email alerts for this search" : "Subscribe to enable email alerts"}
                      >
                        <Mail className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {hasEmail
                        ? "Email alerts enabled - click to disable"
                        : hasActiveSubscription
                        ? "Click to enable email alerts"
                        : "Subscribe to enable email alerts"}
                    </TooltipContent>
                  </Tooltip>

                  {/* Discord notification toggle */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-8 w-8 p-0 transition-opacity ${
                          hasDiscord
                            ? "text-[#5865F2] opacity-100"
                            : "sm:opacity-0 sm:group-hover:opacity-100"
                        }`}
                        onClick={(e) => handleToggleDiscordAlerts(e, search.id, hasDiscord)}
                        disabled={isMutating}
                        aria-label={hasDiscord ? "Disable Discord alerts for this search" : !hasActiveSubscription ? "Subscribe to enable Discord alerts" : !canUseDiscord ? "Set up Discord to enable alerts" : "Enable Discord alerts for this search"}
                      >
                        <DiscordIcon className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {hasDiscord
                        ? "Discord alerts enabled - click to disable"
                        : !hasActiveSubscription
                        ? "Subscribe to enable Discord alerts"
                        : !canUseDiscord
                        ? "Set up Discord in Settings first"
                        : "Click to enable Discord alerts"}
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 transition-opacity hover:bg-destructive hover:text-destructive-foreground sm:opacity-0 sm:group-hover:opacity-100"
                        onClick={(e) => handleDelete(e, search.id)}
                        disabled={deleteMutation.isPending}
                        aria-label={`Delete saved search "${search.name}"`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete saved search</TooltipContent>
                  </Tooltip>
                  <ArrowRight className="text-muted-foreground hidden h-4 w-4 transition-transform group-hover:translate-x-0.5 sm:block" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}

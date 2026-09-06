"use client";

import { MoreHorizontal, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import { toast } from "sonner";
import { EditSavedSearchDialog } from "~/components/settings/EditSavedSearchDialog";
import { SavedSearchUpgradeNotice } from "~/components/search/SavedSearchUpgradeNotice";
import { SavedSearchCriteria } from "~/components/search/SavedSearchCriteria";
import { Button } from "~/components/ui/button";
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
  EmptyTitle,
} from "~/components/ui/empty";
import { Skeleton } from "~/components/ui/skeleton";
import { SavedSearchAlerts } from "~/components/search/SavedSearchAlerts";
import { useAlertSubscriptionAccess } from "~/hooks/use-alert-subscription-access";
import { usePlanAccess } from "~/hooks/use-plan-access";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { buildSearchUrl } from "~/lib/search-utils";
import { resolveClientPlanFeatureAccess } from "~/lib/client-plan-feature-access";
import { api } from "~/trpc/react";

export function SavedSearchSettingsCard() {
  const utils = api.useUtils();
  const { data: searches, isLoading } = api.savedSearches.list.useQuery();
  const { data: notifications } = api.user.getNotificationSettings.useQuery();
  const { canAttemptAlertInteraction, openAlertUpgrade } =
    useAlertSubscriptionAccess("settings_saved_searches");
  const planAccess = usePlanAccess(true);
  const savedSearchesLocked = !resolveClientPlanFeatureAccess({
    access: planAccess,
    feature: "saved_searches",
  });
  const canUseDiscord =
    notifications?.hasDiscordLinked && notifications.discordAppInstalled;

  const deleteSearch = api.savedSearches.delete.useMutation({
    onSuccess: () => {
      toast.success("Search deleted");
      void utils.savedSearches.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete search");
    },
  });
  const toggleEmail = api.savedSearches.toggleEmailAlerts.useMutation({
    onSuccess: (_, variables) => {
      toast.success(
        variables.enabled ? "Email alerts enabled" : "Email alerts disabled",
      );
      void utils.savedSearches.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to toggle email alerts");
    },
  });
  const toggleDiscord = api.savedSearches.toggleDiscordAlerts.useMutation({
    onSuccess: (_, variables) => {
      toast.success(
        variables.enabled
          ? "Discord alerts enabled"
          : "Discord alerts disabled",
      );
      void utils.savedSearches.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to toggle Discord alerts");
    },
  });
  const isMutating =
    deleteSearch.isPending || toggleEmail.isPending || toggleDiscord.isPending;

  const setEmailAlerts = (id: string, enabled: boolean) => {
    if (enabled && !canAttemptAlertInteraction) {
      void openAlertUpgrade();
      return;
    }
    posthog.capture(AnalyticsEvents.SAVED_SEARCH_EMAIL_TOGGLED, {
      search_id: id,
      enabled,
      source: "settings",
    });
    toggleEmail.mutate({ id, enabled });
  };

  const setDiscordAlerts = (id: string, enabled: boolean) => {
    if (enabled && !canAttemptAlertInteraction) {
      void openAlertUpgrade();
      return;
    }
    if (enabled && !canUseDiscord) {
      toast.error("Complete Discord setup in notification settings first");
      return;
    }
    posthog.capture(AnalyticsEvents.SAVED_SEARCH_DISCORD_TOGGLED, {
      search_id: id,
      enabled,
      source: "settings",
    });
    toggleDiscord.mutate({ id, enabled });
  };

  const remove = (id: string) => {
    posthog.capture(AnalyticsEvents.SAVED_SEARCH_DELETED, {
      search_id: id,
      source: "settings",
    });
    deleteSearch.mutate({ id });
  };

  const searchCount = searches?.length ?? 0;

  return (
    <section aria-labelledby="saved-searches-heading">
      <div className="flex items-start justify-between gap-6">
        <div className="max-w-2xl">
          <h2 id="saved-searches-heading" className="text-xl font-semibold">
            Saved searches
          </h2>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            Reopen a vehicle search with its filters intact and choose where
            new-match alerts arrive.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href="/search?advanced=1">
            <Search data-icon="inline-start" />
            New search
          </Link>
        </Button>
      </div>

      <div className="mt-6">
        {isLoading && (
          <div
            aria-label="Loading saved searches"
            className="border-border divide-y border-y"
          >
            {[0, 1].map((index) => (
              <div key={index} className="flex items-center gap-4 py-5">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-52 max-w-full" />
                </div>
                <Skeleton className="h-8 w-24" />
              </div>
            ))}
          </div>
        )}

        {!isLoading && searchCount === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No saved searches yet</EmptyTitle>
              <EmptyDescription>
                Save a search when you want to revisit the same vehicle and
                filters later.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild variant="outline" size="sm">
                <Link href="/search?advanced=1">Create a search</Link>
              </Button>
            </EmptyContent>
          </Empty>
        )}

        {!isLoading && searches && searches.length > 0 && (
          <div>
            {savedSearchesLocked && (
              <SavedSearchUpgradeNotice className="mb-5" />
            )}
            <div className="border-border divide-y border-y">
              {searches.map((search) => {
                return (
                  <div key={search.id}>
                    <div className="grid gap-4 py-6">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        {savedSearchesLocked ? (
                          <span className="text-base font-semibold break-words">
                            {search.name}
                          </span>
                        ) : (
                          <Link
                            href={buildSearchUrl(search.query, search.filters)}
                            aria-label={`Open saved search ${search.name}`}
                            className="focus-visible:ring-ring self-start rounded-sm text-base font-semibold break-words underline-offset-4 outline-none hover:underline focus-visible:ring-2"
                          >
                            {search.name}
                          </Link>
                        )}
                        <div className="flex shrink-0 items-center gap-1">
                          {!savedSearchesLocked && (
                            <EditSavedSearchDialog search={search} />
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
                                  disabled={deleteSearch.isPending}
                                  onSelect={() => remove(search.id)}
                                >
                                  <Trash2 />
                                  Delete saved search
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      <SavedSearchCriteria
                        query={search.query}
                        filters={search.filters}
                      />
                      {savedSearchesLocked ? (
                        <span className="text-muted-foreground text-xs">
                          Alerts are unavailable on your current plan.
                        </span>
                      ) : (
                        <SavedSearchAlerts
                          searchName={search.name}
                          emailEnabled={search.emailAlertsEnabled}
                          discordEnabled={search.discordAlertsEnabled}
                          disabled={isMutating}
                          onEmailChange={(enabled) =>
                            setEmailAlerts(search.id, enabled)
                          }
                          onDiscordChange={(enabled) =>
                            setDiscordAlerts(search.id, enabled)
                          }
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

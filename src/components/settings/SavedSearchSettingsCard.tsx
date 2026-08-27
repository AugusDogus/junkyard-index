"use client";

import { MoreHorizontal, Pencil, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import { toast } from "sonner";
import { SavedSearchUpgradeNotice } from "~/components/search/SavedSearchUpgradeNotice";
import { SEARCH_SORT_OPTIONS } from "~/components/search/search-routing";
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
import { Switch } from "~/components/ui/switch";
import { useAlertSubscriptionAccess } from "~/hooks/use-alert-subscription-access";
import { usePlanAccess } from "~/hooks/use-plan-access";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { resolveClientPlanFeatureAccess } from "~/lib/client-plan-feature-access";
import { INGESTION_SOURCE_DISPLAY_NAMES } from "~/lib/ingestion-source";
import type { SavedSearchFilters } from "~/lib/saved-search-filters";
import { buildSavedSearchEditUrl } from "~/lib/search-utils";
import { api } from "~/trpc/react";

interface SavedSearchCriterion {
  label: string;
  value: string;
}

function getSavedSearchCriteria(
  query: string,
  filters: SavedSearchFilters,
): SavedSearchCriterion[] {
  const criteria: SavedSearchCriterion[] = [];
  if (query.trim()) criteria.push({ label: "Query", value: query });
  if (filters.vinPattern) {
    criteria.push({ label: "VIN pattern", value: filters.vinPattern });
  }
  if (filters.minYear || filters.maxYear) {
    criteria.push({
      label: "Year",
      value:
        filters.minYear && filters.maxYear
          ? `${filters.minYear} to ${filters.maxYear}`
          : filters.minYear
            ? `${filters.minYear} or newer`
            : `${filters.maxYear} or older`,
    });
  }
  if (filters.makes?.length) {
    criteria.push({ label: "Makes", value: filters.makes.join(", ") });
  }
  if (filters.colors?.length) {
    criteria.push({ label: "Colors", value: filters.colors.join(", ") });
  }
  if (filters.states?.length) {
    criteria.push({ label: "States", value: filters.states.join(", ") });
  }
  if (filters.salvageYards?.length) {
    criteria.push({
      label: "Yards",
      value: filters.salvageYards.join(", "),
    });
  }
  if (filters.sources?.length) {
    criteria.push({
      label: "Sources",
      value: filters.sources
        .map((source) => INGESTION_SOURCE_DISPLAY_NAMES[source])
        .join(", "),
    });
  }
  if (filters.sortBy) {
    const sort = SEARCH_SORT_OPTIONS.find(
      (option) =>
        option.key === filters.sortBy || option.indexName === filters.sortBy,
    );
    criteria.push({ label: "Sort", value: sort?.label ?? filters.sortBy });
  }
  return criteria.length > 0
    ? criteria
    : [{ label: "Search", value: "All vehicles" }];
}

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
          <Link href="/search">
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
                <Link href="/search">Search inventory</Link>
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
                const criteria = getSavedSearchCriteria(
                  search.query,
                  search.filters,
                );
                return (
                  <div key={search.id}>
                    <div className="grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                      <div className="flex min-w-0 flex-col gap-2">
                        <span className="text-sm font-medium break-words">
                          {search.name}
                        </span>
                        <dl className="grid gap-1">
                          {criteria.map((criterion) => (
                            <div
                              key={criterion.label}
                              className="flex min-w-0 gap-1.5 text-sm"
                            >
                              <dt className="text-muted-foreground shrink-0">
                                {criterion.label}:
                              </dt>
                              <dd className="min-w-0 break-words">
                                {criterion.value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                        {savedSearchesLocked && (
                          <span className="text-muted-foreground text-xs">
                            Alerts are unavailable on your current plan.
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-5 md:justify-end">
                        {!savedSearchesLocked && (
                          <>
                            <Button asChild variant="outline" size="sm">
                              <Link
                                href={buildSavedSearchEditUrl(
                                  search.id,
                                  search.query,
                                  search.filters,
                                )}
                              >
                                <Pencil />
                                Edit filters
                              </Link>
                            </Button>
                            <div className="flex items-center gap-3">
                              <label
                                htmlFor={`email-alerts-${search.id}`}
                                className="text-sm"
                              >
                                Email
                              </label>
                              <Switch
                                id={`email-alerts-${search.id}`}
                                checked={search.emailAlertsEnabled}
                                onCheckedChange={(enabled) =>
                                  setEmailAlerts(search.id, enabled)
                                }
                                disabled={isMutating}
                                aria-label={`Email alerts for ${search.name}`}
                              />
                            </div>
                            <div className="flex items-center gap-3">
                              <label
                                htmlFor={`discord-alerts-${search.id}`}
                                className="text-sm"
                              >
                                Discord
                              </label>
                              <Switch
                                id={`discord-alerts-${search.id}`}
                                checked={search.discordAlertsEnabled}
                                onCheckedChange={(enabled) =>
                                  setDiscordAlerts(search.id, enabled)
                                }
                                disabled={isMutating}
                                aria-label={`Discord alerts for ${search.name}`}
                              />
                            </div>
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

"use client";

import Link from "next/link";
import posthog from "posthog-js";
import { toast } from "sonner";
import { SavedSearchCard } from "~/components/search/SavedSearchCard";
import { SavedSearchUpgradeNotice } from "~/components/search/SavedSearchUpgradeNotice";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { Skeleton } from "~/components/ui/skeleton";
import { useAlertSubscriptionAccess } from "~/hooks/use-alert-subscription-access";
import { usePlanAccess } from "~/hooks/use-plan-access";
import { AnalyticsEvents } from "~/lib/analytics-events";
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
    return deleteSearch.mutateAsync({ id });
  };

  const searchCount = searches?.length ?? 0;

  return (
    <section aria-labelledby="saved-searches-heading">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2">
        <h2
          id="saved-searches-heading"
          className="text-xl font-semibold text-balance"
        >
          Saved searches
        </h2>
        <Button asChild variant="outline" size="sm" className="min-h-11">
          <Link href="/search?advanced=1">New search</Link>
        </Button>
        <p className="text-muted-foreground col-span-2 text-sm leading-6 text-pretty">
          Open a search, refine its criteria, or choose alerts for new matches.
        </p>
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
            <div className="grid gap-4">
              {searches.map((search) => (
                <SavedSearchCard
                  key={search.id}
                  search={search}
                  locked={savedSearchesLocked}
                  source="settings"
                  deleting={deleteSearch.isPending}
                  togglingAlerts={isMutating}
                  onDelete={() => remove(search.id)}
                  onEmailChange={(enabled) =>
                    setEmailAlerts(search.id, enabled)
                  }
                  onDiscordChange={(enabled) =>
                    setDiscordAlerts(search.id, enabled)
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

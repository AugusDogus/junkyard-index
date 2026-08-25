"use client";

import { Bell, BellOff, Mail, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { DiscordIcon } from "~/components/ui/icons";
import { Skeleton } from "~/components/ui/skeleton";
import { useAlertSubscriptionAccess } from "~/hooks/use-alert-subscription-access";
import { usePlanAccess } from "~/hooks/use-plan-access";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { resolveClientPlanFeatureAccess } from "~/lib/client-plan-feature-access";
import { api } from "~/trpc/react";
import { SavedSearchUpgradeNotice } from "~/components/search/SavedSearchUpgradeNotice";

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
      toast.error("Please complete Discord setup above first");
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Saved Searches
        </CardTitle>
        <CardDescription>
          {savedSearchesLocked
            ? "Your saved searches remain available if you upgrade again."
            : "Manage notifications for your saved searches. Toggle email or Discord alerts for each search."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !searches || searches.length === 0 ? (
          <div className="py-6 text-center">
            <Search className="text-muted-foreground mx-auto mb-3 h-10 w-10" />
            <p className="text-muted-foreground mb-3">No saved searches yet</p>
            <Link href="/search">
              <Button variant="outline" size="sm">
                Go to Search
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {savedSearchesLocked && <SavedSearchUpgradeNotice />}
            {searches.map((search) => (
              <div
                key={search.id}
                className="flex items-center justify-between gap-4 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{search.name}</p>
                  <p className="text-muted-foreground truncate text-sm">
                    {search.query ||
                      search.filters.vinPattern ||
                      "All vehicles"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {!savedSearchesLocked && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-8 w-8 p-0 ${search.emailAlertsEnabled ? "text-blue-500" : "text-muted-foreground"}`}
                        onClick={() =>
                          setEmailAlerts(search.id, !search.emailAlertsEnabled)
                        }
                        disabled={isMutating}
                        title={
                          search.emailAlertsEnabled
                            ? "Email alerts on"
                            : "Email alerts off"
                        }
                        aria-label={
                          search.emailAlertsEnabled
                            ? "Turn off email alerts"
                            : canAttemptAlertInteraction
                              ? "Turn on email alerts"
                              : "Subscribe to enable email alerts"
                        }
                      >
                        {search.emailAlertsEnabled ? (
                          <Mail className="h-4 w-4" />
                        ) : (
                          <BellOff className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-8 w-8 p-0 ${search.discordAlertsEnabled ? "text-[#5865F2]" : "text-muted-foreground"}`}
                        onClick={() =>
                          setDiscordAlerts(
                            search.id,
                            !search.discordAlertsEnabled,
                          )
                        }
                        disabled={isMutating}
                        title={
                          search.discordAlertsEnabled
                            ? "Discord alerts on"
                            : "Discord alerts off"
                        }
                        aria-label={
                          search.discordAlertsEnabled
                            ? "Turn off Discord alerts"
                            : !canAttemptAlertInteraction
                              ? "Subscribe to enable Discord alerts"
                              : !canUseDiscord
                                ? "Set up Discord to enable alerts"
                                : "Turn on Discord alerts"
                        }
                      >
                        <DiscordIcon className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive h-8 w-8 p-0"
                    onClick={() => remove(search.id)}
                    disabled={isMutating}
                    title="Delete search"
                    aria-label={`Delete saved search "${search.name}"`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            <div className="pt-2">
              <Link href="/search">
                <Button variant="outline" size="sm" className="w-full">
                  <Search className="mr-2 h-4 w-4" />
                  {savedSearchesLocked
                    ? "Search Inventory"
                    : "Create New Search"}
                </Button>
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

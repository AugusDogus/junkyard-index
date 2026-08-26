"use client";

import { Bell, Mail, MoreHorizontal, Search, Trash2 } from "lucide-react";
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
import { Switch } from "~/components/ui/switch";
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
      toast.error("Complete Discord setup above first");
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
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b py-5">
        <div className="flex items-center gap-3">
          <div className="bg-secondary flex size-9 items-center justify-center rounded-lg">
            <Bell aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <CardTitle>Saved searches</CardTitle>
              {!isLoading && <Badge variant="secondary">{searchCount}</Badge>}
            </div>
            <CardDescription>
              Reopen searches and choose where match alerts arrive.
            </CardDescription>
          </div>
        </div>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <Link href="/search">
              <Search data-icon="inline-start" />
              <span className="hidden sm:inline">New search</span>
              <span className="sr-only sm:hidden">Start a new search</span>
            </Link>
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading && (
          <div aria-label="Loading saved searches">
            {[0, 1].map((index) => (
              <div key={index}>
                {index > 0 && <Separator />}
                <div className="flex items-center gap-3 px-6 py-5">
                  <Skeleton className="size-10 shrink-0 rounded-lg" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-52 max-w-full" />
                  </div>
                  <Skeleton className="h-8 w-24" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && searchCount === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search />
              </EmptyMedia>
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
              <SavedSearchUpgradeNotice className="m-4 sm:m-5" />
            )}
            {searches.map((search, index) => (
              <div key={search.id}>
                {index > 0 && <Separator />}
                <div className="grid gap-4 px-4 py-4 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="bg-secondary flex size-10 shrink-0 items-center justify-center rounded-lg">
                      <Search aria-hidden="true" />
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">
                          {search.name}
                        </span>
                        {savedSearchesLocked && (
                          <Badge variant="outline">Locked</Badge>
                        )}
                      </div>
                      <span className="text-muted-foreground truncate text-sm">
                        {search.query ||
                          search.filters.vinPattern ||
                          "All vehicles"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-4 pl-13 md:pl-0">
                    {!savedSearchesLocked && (
                      <>
                        <div className="flex items-center gap-2">
                          <Mail aria-hidden="true" className="size-4" />
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
                        <div className="flex items-center gap-2">
                          <DiscordIcon aria-hidden="true" className="size-4" />
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
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

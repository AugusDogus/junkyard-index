"use client";

import { Bookmark, Lock } from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import { toast } from "sonner";
import { SavedSearchCard } from "~/components/search/SavedSearchCard";
import { SavedSearchUpgradeNotice } from "~/components/search/SavedSearchUpgradeNotice";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
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
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

interface SavedSearchesListProps {
  locked: boolean;
  className?: string;
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
    return deleteMutation.mutateAsync({ id });
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
    <section aria-label="Saved searches" className={cn("min-w-0", className)}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-balance">
          Saved searches
          {!isLoading && <Badge variant="secondary">{searchCount}</Badge>}
        </h2>
        <Button asChild variant="ghost" size="sm" className="min-h-11">
          <Link href="/settings/searches">Manage</Link>
        </Button>
      </div>
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
        <div className="grid gap-4">
          {savedSearches.map((search) => (
            <SavedSearchCard
              key={search.id}
              search={search}
              locked={locked}
              source="saved_searches_list"
              deleting={deleteMutation.isPending}
              togglingAlerts={
                toggleEmailAlertsMutation.isPending ||
                toggleDiscordAlertsMutation.isPending
              }
              onDelete={() => handleDelete(search.id)}
              onEmailChange={(enabled) =>
                handleToggleEmailAlerts(search.id, enabled)
              }
              onDiscordChange={(enabled) =>
                handleToggleDiscordAlerts(search.id, enabled)
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

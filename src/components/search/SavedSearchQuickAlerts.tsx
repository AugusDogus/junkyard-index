"use client";

import { Bell, BellOff } from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import { useId, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Switch } from "~/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { useAlertSubscriptionAccess } from "~/hooks/use-alert-subscription-access";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { api, type RouterOutputs } from "~/trpc/react";

type Channel = "email" | "discord";
type SavedSearch = RouterOutputs["savedSearches"]["list"][number];

export function SavedSearchQuickAlerts({
  search,
  source,
}: {
  search: SavedSearch;
  source: "settings" | "saved_searches_list";
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const utils = api.useUtils();
  const { canAttemptAlertInteraction, openAlertUpgrade } =
    useAlertSubscriptionAccess(source);
  const notifications = api.user.getNotificationSettings.useQuery(undefined, {
    enabled: open,
  });
  const saved = async (channel: Channel, enabled: boolean) => {
    await utils.savedSearches.list.cancel();
    utils.savedSearches.list.setData(undefined, (searches) =>
      searches?.map((item) =>
        item.id === search.id
          ? {
              ...item,
              ...(channel === "email"
                ? { emailAlertsEnabled: enabled }
                : { discordAlertsEnabled: enabled }),
            }
          : item,
      ),
    );
    posthog.capture(
      channel === "email"
        ? AnalyticsEvents.SAVED_SEARCH_EMAIL_TOGGLED
        : AnalyticsEvents.SAVED_SEARCH_DISCORD_TOGGLED,
      { search_id: search.id, enabled, source },
    );
    await utils.savedSearches.list.invalidate();
  };
  const email = api.savedSearches.toggleEmailAlerts.useMutation({
    onSuccess: (_result, input) => saved("email", input.enabled),
    onError: (failure) =>
      setError(
        `The email alert change could not be confirmed. ${failure.message} Try again.`,
      ),
  });
  const discord = api.savedSearches.toggleDiscordAlerts.useMutation({
    onSuccess: (_result, input) => saved("discord", input.enabled),
    onError: (failure) =>
      setError(
        `The Discord alert change could not be confirmed. ${failure.message} Try again.`,
      ),
  });
  const pending = email.isPending || discord.isPending;
  const change = async (channel: Channel, enabled: boolean) => {
    if (pending) return;
    setError(undefined);
    if (enabled && !canAttemptAlertInteraction) {
      void openAlertUpgrade();
      return;
    }
    if (channel === "discord" && enabled) {
      const setup = await notifications.refetch();
      if (setup.isError || !setup.data) {
        setError("Discord setup could not be checked. Try again.");
        return;
      }
      if (!setup.data.hasDiscordLinked || !setup.data.discordAppInstalled) {
        setError(
          "Set up Discord using Notification setup below, then try again.",
        );
        return;
      }
    }
    const mutation = channel === "email" ? email : discord;
    mutation.mutate({ id: search.id, enabled });
  };
  const channels = [
    { key: "email", name: "Email", enabled: search.emailAlertsEnabled },
    { key: "discord", name: "Discord", enabled: search.discordAlertsEnabled },
  ] as const;
  const enabledNames = channels
    .filter((channel) => channel.enabled)
    .map((channel) => channel.name);
  const label = `Alerts for ${search.name}: ${enabledNames.join(" and ") || "Off"}`;
  const Icon = enabledNames.length ? Bell : BellOff;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground relative size-11 shrink-0"
              aria-label={label}
            >
              <Icon aria-hidden="true" />
              {enabledNames.length > 0 && (
                <span
                  aria-hidden="true"
                  className="bg-foreground absolute top-2 right-2 size-1 rounded-full"
                />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={16}
        className="w-72 max-w-[calc(100vw-2rem)]"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-search`}
      >
        <PopoverHeader>
          <PopoverTitle id={`${id}-title`}>Alerts for this search</PopoverTitle>
          <PopoverDescription id={`${id}-search`} className="break-words">
            {search.name}
          </PopoverDescription>
        </PopoverHeader>
        <fieldset className="mt-3 grid gap-1" aria-busy={pending}>
          <legend className="sr-only">Notification channels</legend>
          {channels.map((channel) => (
            <label
              key={channel.key}
              htmlFor={`${id}-${channel.key}`}
              className="hover:bg-muted/50 flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-2 text-sm"
            >
              <span className="flex-1">{channel.name}</span>
              <span className="text-muted-foreground text-xs">
                {channel.enabled ? "On" : "Off"}
              </span>
              <Switch
                id={`${id}-${channel.key}`}
                checked={channel.enabled}
                disabled={
                  pending ||
                  (channel.key === "discord" &&
                    !channel.enabled &&
                    notifications.isFetching)
                }
                onCheckedChange={(enabled) => void change(channel.key, enabled)}
                aria-label={`${channel.name} alerts for ${search.name}`}
              />
            </label>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="text-destructive mt-3 text-sm">
            {error}
          </p>
        )}
        <p role="status" className="text-muted-foreground mt-3 text-xs">
          {pending ? "Saving…" : "Changes save automatically."}
        </p>
        <Link
          href="/settings/notifications"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground mt-1 flex min-h-11 items-center text-xs underline underline-offset-4"
        >
          Notification setup (new tab)
        </Link>
      </PopoverContent>
    </Popover>
  );
}

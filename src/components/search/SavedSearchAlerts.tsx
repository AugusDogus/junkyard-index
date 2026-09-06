"use client";

import { useId } from "react";
import { Switch } from "~/components/ui/switch";

export function SavedSearchAlerts({
  searchName,
  emailEnabled,
  discordEnabled,
  disabled,
  onEmailChange,
  onDiscordChange,
}: {
  searchName: string;
  emailEnabled: boolean;
  discordEnabled: boolean;
  disabled: boolean;
  onEmailChange: (enabled: boolean) => void;
  onDiscordChange: (enabled: boolean) => void;
}) {
  const id = useId();
  const channels = [
    { name: "Email", enabled: emailEnabled, onChange: onEmailChange },
    { name: "Discord", enabled: discordEnabled, onChange: onDiscordChange },
  ];

  return (
    <fieldset className="bg-muted/30 min-w-0 border-t p-5 sm:p-6 @xl:border-t-0 @xl:border-l">
      <legend className="sr-only">Alerts for {searchName}</legend>
      <p className="text-sm font-medium text-pretty">
        New matches for this search
      </p>
      <div className="mt-3 grid gap-1">
        {channels.map((channel) => (
          <label
            key={channel.name}
            htmlFor={`${id}-${channel.name}`}
            className="flex min-h-11 items-center gap-3 text-sm"
          >
            <span className="flex-1">{channel.name}</span>
            <span className="text-muted-foreground text-xs">
              {channel.enabled ? "On" : "Off"}
            </span>
            <Switch
              id={`${id}-${channel.name}`}
              checked={channel.enabled}
              onCheckedChange={channel.onChange}
              disabled={disabled}
              aria-label={`${channel.name} alerts for ${searchName}`}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

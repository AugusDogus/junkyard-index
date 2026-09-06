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
    <fieldset className="min-w-0">
      <legend className="sr-only">Alerts for {searchName}</legend>
      <div className="mt-3 grid divide-y border-y">
        {channels.map((channel) => (
          <label
            key={channel.name}
            htmlFor={`${id}-${channel.name}`}
            className="flex min-h-14 items-center gap-3 text-sm"
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

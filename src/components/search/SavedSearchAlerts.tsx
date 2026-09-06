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
    <fieldset className="min-w-0 border-t pt-3">
      <legend className="sr-only">Alerts for {searchName}</legend>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <span className="text-muted-foreground w-full text-sm sm:w-auto">
          Alerts
        </span>
        {channels.map((channel) => (
          <label
            key={channel.name}
            htmlFor={`${id}-${channel.name}`}
            className="inline-flex min-h-11 items-center gap-2 text-sm"
          >
            {channel.name}
            <Switch
              id={`${id}-${channel.name}`}
              checked={channel.enabled}
              onCheckedChange={channel.onChange}
              disabled={disabled}
              aria-label={`${channel.name} alerts for ${searchName}`}
            />
            <span className="text-muted-foreground w-5 text-xs">
              {channel.enabled ? "On" : "Off"}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

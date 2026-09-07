"use client";
import { Bell, BellOff, Pencil } from "lucide-react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { SavedSearchFilters } from "~/lib/saved-search-filters";
interface EditSavedSearchLinkProps {
  search: {
    id: string;
    name: string;
    query: string;
    filters: SavedSearchFilters;
    emailAlertsEnabled: boolean;
    discordAlertsEnabled: boolean;
  };
  source?: "settings" | "saved_searches_list";
  trigger?: "edit" | "alerts";
}

export function EditSavedSearchLink({
  search,
  source = "settings",
  trigger = "edit",
}: EditSavedSearchLinkProps) {
  const channels = [
    search.emailAlertsEnabled ? "Email" : null,
    search.discordAlertsEnabled ? "Discord" : null,
  ].filter(Boolean);
  const alertLabel = channels.length
    ? `Alerts for ${search.name}: ${channels.join(" and ")}`
    : `Alerts off for ${search.name}`;
  const label =
    trigger === "alerts" ? alertLabel : `Edit saved search ${search.name}`;
  const Icon = trigger === "edit" ? Pencil : channels.length ? Bell : BellOff;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-11 shrink-0 sm:size-8"
        >
          <Link
            href={`/saved-searches/${encodeURIComponent(search.id)}/edit?from=${source === "settings" ? "settings" : "search"}${trigger === "alerts" ? "&focus=alerts" : ""}`}
            aria-label={label}
          >
            <Icon aria-hidden="true" />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {trigger === "alerts" ? alertLabel : "Edit search"}
      </TooltipContent>
    </Tooltip>
  );
}

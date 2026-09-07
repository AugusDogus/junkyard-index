"use client";
import { Pencil } from "lucide-react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
interface EditSavedSearchLinkProps {
  search: {
    id: string;
    name: string;
  };
  source?: "settings" | "saved_searches_list";
}

export function EditSavedSearchLink({
  search,
  source = "settings",
}: EditSavedSearchLinkProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="text-muted-foreground relative size-11 shrink-0"
        >
          <Link
            href={`/saved-searches/${encodeURIComponent(search.id)}/edit?from=${source === "settings" ? "settings" : "search"}`}
            aria-label={`Edit saved search ${search.name}`}
          >
            <Pencil aria-hidden="true" />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Edit search</TooltipContent>
    </Tooltip>
  );
}

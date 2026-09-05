"use client";

import { Search, X } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

type SearchFieldProps = ComponentProps<typeof Input> & {
  onClear?: () => void;
};

/** Shared geometry keeps the landing and results search fields in place. */
export function SearchField({
  className,
  onClear,
  ...props
}: SearchFieldProps) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div
        className={cn(
          "border-input bg-card focus-within:border-ring focus-within:ring-ring/30 flex h-11 min-w-0 flex-1 items-center gap-1 rounded-md border px-1 focus-within:ring-2 sm:h-10",
          props["aria-invalid"] &&
            "border-destructive focus-within:border-destructive",
        )}
      >
        <Search
          className="text-muted-foreground ml-2 hidden size-4 shrink-0 sm:block"
          aria-hidden="true"
        />
        <Input
          type="search"
          role="searchbox"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Year, make, model, or VIN"
          {...props}
          className={cn(
            "h-9 min-w-0 flex-1 rounded-none border-0 bg-transparent px-2 text-base shadow-none outline-none focus-visible:ring-0 md:text-base dark:bg-transparent [&::-webkit-search-cancel-button]:hidden",
            className,
          )}
        />
        {onClear && props.value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear search"
            onClick={onClear}
            className="shrink-0"
          >
            <X />
          </Button>
        )}
      </div>
      <Button
        type="submit"
        variant="outline"
        className="bg-muted/40 hover:bg-muted dark:bg-muted/40 dark:hover:bg-muted h-11 shrink-0 rounded-md px-3.5 shadow-none transition-colors sm:h-10"
      >
        Search
      </Button>
    </div>
  );
}

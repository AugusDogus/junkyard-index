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
    <div className="flex min-w-0 items-center">
      <div
        className={cn(
          "border-ink bg-paper-3 focus-within:outline-focus flex h-12 min-w-0 flex-1 items-center gap-1 border-2 px-1 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-solid",
          props["aria-invalid"] &&
            "border-destructive focus-within:border-destructive",
        )}
      >
        <Search
          className="text-ink-2 ml-2 hidden size-5 shrink-0 sm:block"
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
            "placeholder:text-ink-3 h-10 min-w-0 flex-1 border-0 bg-transparent px-2 text-base outline-none focus-visible:outline-none md:text-base dark:bg-transparent [&::-webkit-search-cancel-button]:hidden",
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
      <Button type="submit" className="h-12 shrink-0 px-3 sm:px-6">
        Search
      </Button>
    </div>
  );
}

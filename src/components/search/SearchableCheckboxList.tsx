"use client";

import { Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";

interface SearchableCheckboxListProps {
  /** Unique name used to namespace checkbox ids and avoid DOM collisions. */
  name: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  searchPlaceholder?: string;
  /** Show the search input when the number of options exceeds this threshold. */
  searchThreshold?: number;
  /** Max visible height (px) before the list scrolls internally. */
  maxHeight?: number;
}

export function SearchableCheckboxList({
  name,
  options,
  selected,
  onChange,
  searchPlaceholder = "Search…",
  searchThreshold = 8,
  maxHeight = 200,
}: SearchableCheckboxListProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const showSearch = options.length > searchThreshold;

  const filtered = useMemo(() => {
    if (!query) return options;
    const lower = query.toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(lower));
  }, [options, query]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Pin selected items to top only when not actively searching
  const sorted = useMemo(() => {
    if (query) return filtered;
    return [...filtered].sort((a, b) => {
      const aSelected = selectedSet.has(a);
      const bSelected = selectedSet.has(b);
      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;
      return 0;
    });
  }, [filtered, selectedSet, query]);

  const toggle = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selected.filter((s) => s !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <div className="space-y-2">
      {showSearch && (
        <div className="relative px-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="border-input placeholder:text-muted-foreground focus-visible:ring-ring/50 focus-visible:border-ring h-8 w-full rounded-md border bg-transparent pr-7 pl-8 text-sm outline-none focus-visible:ring-[3px]"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <div
        className="scrollbar-thin-themed overflow-y-auto overscroll-contain"
        style={{ maxHeight }}
      >
        {sorted.length === 0 ? (
          <p className="text-muted-foreground px-3 py-2 text-sm">
            No matches
          </p>
        ) : (
          sorted.map((option) => (
            <div
              key={option}
              className="flex items-center space-x-2 rounded px-3 py-1"
            >
              <Checkbox
                id={`${name}-${option}`}
                checked={selectedSet.has(option)}
                onCheckedChange={() => toggle(option)}
              />
              <Label
                htmlFor={`${name}-${option}`}
                className="cursor-pointer text-sm leading-none"
              >
                {option}
              </Label>
            </div>
          ))
        )}
      </div>

      {selected.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="text-muted-foreground hover:text-foreground px-3 text-xs underline-offset-2 hover:underline"
        >
          Clear selection
        </button>
      )}
    </div>
  );
}

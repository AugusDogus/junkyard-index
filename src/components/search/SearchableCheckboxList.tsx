"use client";

import { Search, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "~/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "~/components/ui/input-group";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

interface SearchableCheckboxListProps {
  /** Unique name used to namespace checkbox ids and avoid DOM collisions. */
  name: string;
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  searchPlaceholder?: string;
  /** Show the search input when the number of options exceeds this threshold. */
  searchThreshold?: number;
  /** Max visible height (px) before the list scrolls internally. */
  maxHeight?: number;
  scrollMode?: "contained" | "parent";
}

export function SearchableCheckboxList({
  name,
  label,
  options,
  selected,
  onChange,
  searchPlaceholder = "Search…",
  searchThreshold = 8,
  maxHeight = 200,
  scrollMode = "contained",
}: SearchableCheckboxListProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const idPrefix = useId();

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
    <FieldSet className="gap-3">
      <FieldLegend className="sr-only">{label}</FieldLegend>
      {showSearch && (
        <InputGroup>
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
          {query && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label={`Clear ${label.toLowerCase()} search`}
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
              >
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
      )}

      <div
        className={cn(
          scrollMode === "contained" &&
            "scrollbar-thin-themed overflow-y-auto overscroll-contain",
        )}
        style={scrollMode === "contained" ? { maxHeight } : undefined}
      >
        {sorted.length === 0 ? (
          query ? (
            <p
              className="text-muted-foreground px-3 py-2 text-sm"
              role="status"
              aria-live="polite"
            >
              No matches
            </p>
          ) : null
        ) : (
          <FieldGroup className="gap-1">
            {sorted.map((option) => {
              const optionId = `${idPrefix}-${name}-${encodeURIComponent(option)}`;
              return (
                <Field
                  key={option}
                  orientation="horizontal"
                  className="hover:bg-muted/60 min-h-9 gap-3 rounded-md px-2 py-2"
                >
                  <Checkbox
                    id={optionId}
                    checked={selectedSet.has(option)}
                    onCheckedChange={() => toggle(option)}
                  />
                  <FieldLabel
                    htmlFor={optionId}
                    className="min-w-0 cursor-pointer"
                  >
                    <span className="truncate">{option}</span>
                  </FieldLabel>
                </Field>
              );
            })}
          </FieldGroup>
        )}
      </div>

      {selected.length > 0 && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="self-start"
          onClick={() => onChange([])}
        >
          Clear selection
        </Button>
      )}
    </FieldSet>
  );
}

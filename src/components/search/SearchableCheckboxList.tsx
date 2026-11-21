"use client";

import {
  defaultRangeExtractor,
  useVirtualizer,
  type Virtualizer,
} from "@tanstack/react-virtual";
import { Plus, Search, X } from "lucide-react";
import {
  Fragment,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  containScroll?: boolean;
  /** Allow saved-search criteria that are absent from current inventory. */
  allowCustomValues?: boolean;
  /** Shown above the options, such as while they load or after they fail. */
  feedback?: ReactNode;
}

/**
 * Lists longer than this render only the rows in view. Colors (about 1,900)
 * and yards (about 400) otherwise re-render every row whenever the search
 * page renders, which stalls scrolling while a filter is open.
 */
const VIRTUALIZE_ABOVE = 60;
/** A row is min-h-9 (36px) plus the 4px gap between rows. */
const ROW_SIZE = 40;

export function SearchableCheckboxList({
  name,
  label,
  options,
  selected,
  onChange,
  searchPlaceholder = "Search…",
  searchThreshold = 8,
  maxHeight = 200,
  containScroll = true,
  allowCustomValues = false,
  feedback,
}: SearchableCheckboxListProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const idPrefix = useId();

  const showSearch = allowCustomValues || options.length > searchThreshold;
  const customValue = query.trim();
  const canAddCustomValue =
    allowCustomValues &&
    customValue.length > 0 &&
    ![...options, ...selected].some(
      (option) => option.toLowerCase() === customValue.toLowerCase(),
    );
  const addCustomValue = () => {
    if (!canAddCustomValue) return;
    onChange([...selected, customValue]);
    setQuery("");
    inputRef.current?.focus();
  };

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

  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const virtualize = sorted.length > VIRTUALIZE_ABOVE;
  const virtualizer = useVirtualizer({
    count: virtualize ? sorted.length : 0,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => sorted[index] ?? index,
    estimateSize: () => ROW_SIZE,
    initialRect: { width: 320, height: maxHeight },
    overscan: 8,
    // Keep the focused row mounted so keyboard focus survives scrolling.
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      return focusedIndex === null ||
        focusedIndex >= range.count ||
        indexes.includes(focusedIndex)
        ? indexes
        : [...indexes, focusedIndex].sort((a, b) => a - b);
    },
  });

  const renderOption = (option: string) => {
    const optionId = `${idPrefix}-${name}-${encodeURIComponent(option)}`;
    return (
      <Field
        orientation="horizontal"
        className="hover:bg-muted/60 min-h-9 gap-3 rounded-md px-2 py-2"
      >
        <Checkbox
          id={optionId}
          checked={selectedSet.has(option)}
          onCheckedChange={() => toggle(option)}
        />
        <FieldLabel htmlFor={optionId} className="min-w-0 cursor-pointer">
          <span className="truncate">{option}</span>
        </FieldLabel>
      </Field>
    );
  };

  return (
    <FieldSet className="gap-3">
      <FieldLegend className="sr-only">{label}</FieldLegend>
      {feedback}
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
            onKeyDown={(event) => {
              if (allowCustomValues && event.key === "Enter") {
                event.preventDefault();
                if (!event.nativeEvent.isComposing) addCustomValue();
              }
            }}
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

      {canAddCustomValue && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-w-full self-start"
          onClick={addCustomValue}
        >
          <Plus data-icon="inline-start" />
          <span className="truncate">Add &ldquo;{customValue}&rdquo;</span>
        </Button>
      )}

      <div
        ref={scrollRef}
        className={cn(
          "scrollbar-thin-themed overflow-y-auto",
          containScroll && "overscroll-contain",
        )}
        style={{ maxHeight }}
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
        ) : virtualize ? (
          <VirtualOptions
            virtualizer={virtualizer}
            options={sorted}
            renderOption={renderOption}
            onFocusIndex={setFocusedIndex}
          />
        ) : (
          <FieldGroup className="gap-1">
            {sorted.map((option) => (
              <Fragment key={option}>{renderOption(option)}</Fragment>
            ))}
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

function VirtualOptions({
  virtualizer,
  options,
  renderOption,
  onFocusIndex,
}: {
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  options: string[];
  renderOption: (option: string) => ReactNode;
  onFocusIndex: (index: number | null) => void;
}) {
  return (
    <FieldGroup
      // Fields lay out against this group's container queries.
      className="relative gap-0"
      style={{ height: virtualizer.getTotalSize() }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          onFocusIndex(null);
      }}
    >
      {virtualizer.getVirtualItems().map((row) => {
        const option = options[row.index];
        if (option === undefined) return null;
        return (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className="absolute inset-x-0 top-0 pb-1"
            style={{ transform: `translateY(${row.start}px)` }}
            onFocus={() => onFocusIndex(row.index)}
          >
            {renderOption(option)}
          </div>
        );
      })}
    </FieldGroup>
  );
}

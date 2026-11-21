"use client";

import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { Plus, Search, X } from "lucide-react";
import {
  Fragment,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
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
  const optionId = (option: string) =>
    `${idPrefix}-${name}-${encodeURIComponent(option)}`;

  const renderOption = (option: string) => {
    return (
      <Field
        orientation="horizontal"
        className="hover:bg-muted/60 min-h-9 gap-3 rounded-md px-2 py-2"
      >
        <Checkbox
          id={optionId(option)}
          checked={selectedSet.has(option)}
          onCheckedChange={() => toggle(option)}
        />
        <FieldLabel
          htmlFor={optionId(option)}
          className="min-w-0 cursor-pointer"
        >
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
        ) : sorted.length > VIRTUALIZE_ABOVE ? (
          <VirtualOptions
            options={sorted}
            scrollRef={scrollRef}
            viewportHeight={maxHeight}
            optionId={optionId}
            renderOption={renderOption}
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

/**
 * Renders the rows in view plus the focused one. Focus is tracked by option,
 * not position, because selecting an option re-sorts it to the top. Keyboard
 * entry from outside lands on the first or last option, as it would if every
 * row were mounted.
 */
function VirtualOptions({
  options,
  scrollRef,
  viewportHeight,
  optionId,
  renderOption,
}: {
  options: string[];
  scrollRef: RefObject<HTMLDivElement | null>;
  viewportHeight: number;
  optionId: (option: string) => string;
  renderOption: (option: string) => ReactNode;
}) {
  const [focused, setFocused] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const pointerDown = useRef(false);
  const focusedIndex = focused === null ? -1 : options.indexOf(focused);
  const virtualizer = useVirtualizer({
    count: options.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => options[index] ?? index,
    estimateSize: () => ROW_SIZE,
    initialRect: { width: 320, height: viewportHeight },
    overscan: 8,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      return focusedIndex < 0 || indexes.includes(focusedIndex)
        ? indexes
        : [...indexes, focusedIndex].sort((a, b) => a - b);
    },
  });

  // Focus a redirected entry once its row has mounted.
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    const element = document.getElementById(optionId(target));
    if (!element) return;
    pendingFocus.current = null;
    element.focus({ preventScroll: true });
  });

  const enterAt = (index: number) => {
    const target = options[index];
    if (target === undefined) return;
    setFocused(target);
    const element = document.getElementById(optionId(target));
    if (element) {
      element.focus();
      return;
    }
    pendingFocus.current = target;
    virtualizer.scrollToIndex(index, { align: "auto" });
  };

  return (
    <FieldGroup
      role="list"
      // Fields lay out against this group's container queries.
      className="relative gap-0"
      style={{ height: virtualizer.getTotalSize() }}
      onPointerDown={() => {
        pointerDown.current = true;
      }}
      onPointerUp={() => {
        pointerDown.current = false;
      }}
      onFocus={(event) => {
        const from = event.relatedTarget;
        const entering = !event.currentTarget.contains(from);
        if (!entering || pointerDown.current || !(from instanceof Node)) return;
        const fromBefore =
          (from.compareDocumentPosition(event.currentTarget) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
          0;
        const index = fromBefore ? 0 : options.length - 1;
        if (options[index] !== focused) enterAt(index);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(null);
      }}
    >
      {virtualizer.getVirtualItems().map((row) => {
        const option = options[row.index];
        if (option === undefined) return null;
        return (
          <div
            key={row.key}
            role="listitem"
            aria-setsize={options.length}
            aria-posinset={row.index + 1}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className="absolute inset-x-0 top-0 pb-1"
            style={{ transform: `translateY(${row.start}px)` }}
            onFocus={() => setFocused(option)}
          >
            {renderOption(option)}
          </div>
        );
      })}
    </FieldGroup>
  );
}

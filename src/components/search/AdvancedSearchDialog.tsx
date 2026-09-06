"use client";

import { LockKeyhole, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  InventorySourcesFilter,
  YearRangeFilter,
} from "~/components/search/FilterFields";
import { SearchableCheckboxList } from "~/components/search/SearchableCheckboxList";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { SEARCH_SORT_OPTIONS } from "~/components/search/search-routing";
import {
  buildAdvancedSearchQuery,
  parseAdvancedSearchQuery,
  type AdvancedSearchQueryFields,
} from "~/lib/advanced-search-query";
import { cn } from "~/lib/utils";
import { InventoryFilterOptions } from "~/lib/inventory-filter-options";
import type { DataSource } from "~/lib/types";

interface AdvancedSearchFilters {
  makes: string[];
  colors: string[];
  states: string[];
  salvageYards: string[];
  sources: DataSource[];
  yearRange: [number, number];
  sortBy: string;
}

export interface AdvancedSearchSubmission extends AdvancedSearchFilters {
  query: string;
}

interface AdvancedSearchDialogProps extends AdvancedSearchFilters {
  query: string;
  filterOptions: InventoryFilterOptions | undefined;
  filterOptionsFeedback?: React.ReactNode;
  yearRangeLimits: { min: number; max: number };
  canUseAdvancedFilters: boolean;
  booleanOrSearchReady: boolean;
  triggerClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
  onSearch: (submission: AdvancedSearchSubmission) => void;
}

const EMPTY_QUERY_FIELDS: AdvancedSearchQueryFields = {
  allWords: "",
  exactPhrase: "",
  anyWords: "",
  excludedWords: "",
};

function QueryField({
  id,
  operator,
  label,
  description,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  operator: string;
  label: string;
  description: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[5rem_minmax(0,1fr)] sm:items-start">
      <Badge variant="outline" className="mt-7 font-mono">
        {operator}
      </Badge>
      <div className="grid gap-2">
        <div>
          <Label htmlFor={id}>{label}</Label>
          <p className="text-muted-foreground mt-1 text-xs text-pretty">
            {description}
          </p>
        </div>
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
        />
      </div>
    </div>
  );
}

function FilterPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border p-4">
      <h4 className="mb-3 text-sm font-medium">{title}</h4>
      {children}
    </section>
  );
}

export function AdvancedSearchDialog({
  query,
  makes,
  colors,
  states,
  salvageYards,
  sources,
  yearRange,
  sortBy,
  filterOptions,
  filterOptionsFeedback,
  yearRangeLimits,
  canUseAdvancedFilters,
  booleanOrSearchReady,
  triggerClassName,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
  onSearch,
}: AdvancedSearchDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [dialogContent, setDialogContent] = useState<HTMLDivElement | null>(
    null,
  );
  const open = controlledOpen ?? internalOpen;
  const wasOpen = useRef(false);
  const [queryFields, setQueryFields] =
    useState<AdvancedSearchQueryFields>(EMPTY_QUERY_FIELDS);
  const [editableQuery, setEditableQuery] = useState("");
  const [draftFilters, setDraftFilters] = useState<AdvancedSearchFilters>({
    makes,
    colors,
    states,
    salvageYards,
    sources,
    yearRange,
    sortBy,
  });
  const [queryError, setQueryError] = useState<string | null>(null);
  const availableFilters = InventoryFilterOptions.withSelected(
    filterOptions,
    draftFilters,
  );

  const initializeDraft = useCallback(() => {
    const initialFields = { ...EMPTY_QUERY_FIELDS, allWords: query };
    setQueryFields(initialFields);
    setEditableQuery(query);
    setDraftFilters({
      makes,
      colors,
      states,
      salvageYards,
      sources,
      yearRange,
      sortBy,
    });
    setQueryError(null);
  }, [colors, makes, query, salvageYards, sortBy, sources, states, yearRange]);

  useEffect(() => {
    if (open && !wasOpen.current) initializeDraft();
    wasOpen.current = open;
  }, [initializeDraft, open]);

  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const updateQueryFields = (nextFields: AdvancedSearchQueryFields) => {
    setQueryFields(nextFields);
    setEditableQuery(buildAdvancedSearchQuery(nextFields));
    setQueryError(null);
  };

  const resetDraft = () => {
    setQueryFields(EMPTY_QUERY_FIELDS);
    setEditableQuery("");
    setDraftFilters({
      makes: [],
      colors: [],
      states: [],
      salvageYards: [],
      sources: [],
      yearRange: [yearRangeLimits.min, yearRangeLimits.max],
      sortBy: "newest",
    });
    setQueryError(null);
  };

  const submit = () => {
    const normalizedQuery = editableQuery.trim();
    if (!normalizedQuery) {
      setQueryError("Add at least one word, phrase, or exclusion.");
      return;
    }

    const parsed = parseAdvancedSearchQuery(normalizedQuery);
    if (!parsed.success) {
      setQueryError(parsed.error);
      return;
    }
    if (parsed.data.anyWordGroups.length > 0 && !booleanOrSearchReady) {
      setQueryError(
        "Boolean OR search is temporarily unavailable while the search index updates.",
      );
      return;
    }

    onSearch({ query: normalizedQuery, ...draftFilters });
    setOpen(false);
  };

  const triggerClassNames = cn("justify-start", triggerClassName);

  if (!canUseAdvancedFilters) {
    if (!showTrigger) {
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Upgrade to use advanced search</DialogTitle>
              <DialogDescription className="text-pretty">
                Build Boolean queries and combine inventory filters on a paid
                plan.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button asChild>
                <Link href="/pricing">Compare plans</Link>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }

    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="link"
            size="sm"
            className={triggerClassNames}
            aria-label="Advanced search, upgrade required"
          >
            <LockKeyhole data-icon="inline-start" aria-hidden="true" />
            Advanced search
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8}>
          <PopoverHeader>
            <PopoverTitle>Upgrade to use advanced search</PopoverTitle>
            <PopoverDescription className="text-pretty">
              Build Boolean queries and combine inventory filters on a paid
              plan.
            </PopoverDescription>
          </PopoverHeader>
          <Button asChild size="sm" className="mt-4">
            <Link href="/pricing">Compare plans</Link>
          </Button>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger && (
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="link"
            size="sm"
            className={triggerClassNames}
          >
            Advanced search
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        ref={setDialogContent}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogHeader className="border-b px-6 py-5 pr-12">
            <DialogTitle className="text-xl text-balance">
              Build an advanced search
            </DialogTitle>
            <DialogDescription className="max-w-2xl text-pretty">
              Combine exact phrases, alternatives, and exclusions. The result
              stays readable, editable, and shareable in the search URL.
            </DialogDescription>
          </DialogHeader>

          <div className="scrollbar-thin-themed min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
              <section aria-labelledby="keyword-builder-title">
                <h3 id="keyword-builder-title" className="font-semibold">
                  Keywords
                </h3>
                <p className="text-muted-foreground mt-1 text-sm text-pretty">
                  Fill in only the rows you need. Commas separate alternatives.
                </p>

                <div className="mt-5 grid gap-5">
                  <QueryField
                    id="advanced-all-words"
                    operator="AND"
                    label="All of these words"
                    description="Every word must appear in a matching vehicle."
                    placeholder="pickup truck"
                    value={queryFields.allWords}
                    onChange={(allWords) =>
                      updateQueryFields({ ...queryFields, allWords })
                    }
                  />
                  <QueryField
                    id="advanced-exact-phrase"
                    operator={'" "'}
                    label="This exact phrase"
                    description="Words must appear together, in this order."
                    placeholder="crew cab"
                    value={queryFields.exactPhrase}
                    onChange={(exactPhrase) =>
                      updateQueryFields({ ...queryFields, exactPhrase })
                    }
                  />
                  <QueryField
                    id="advanced-any-words"
                    operator="OR"
                    label="Any of these words"
                    description="Broaden the search with interchangeable alternatives."
                    placeholder="Ford, Chevrolet, Ram"
                    value={queryFields.anyWords}
                    onChange={(anyWords) =>
                      updateQueryFields({ ...queryFields, anyWords })
                    }
                  />
                  <QueryField
                    id="advanced-excluded-words"
                    operator="NOT"
                    label="None of these words"
                    description="Prefix exclusions with ! in the final query."
                    placeholder="diesel, damaged"
                    value={queryFields.excludedWords}
                    onChange={(excludedWords) =>
                      updateQueryFields({ ...queryFields, excludedWords })
                    }
                  />
                </div>
              </section>

              <section aria-labelledby="query-preview-title">
                <div className="bg-muted/40 rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 id="query-preview-title" className="font-semibold">
                      Power query
                    </h3>
                    <Badge variant="secondary">Editable</Badge>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs text-pretty">
                    You can also type this syntax directly in the regular search
                    field.
                  </p>
                  <Label htmlFor="advanced-query-preview" className="sr-only">
                    Generated advanced query
                  </Label>
                  <Textarea
                    id="advanced-query-preview"
                    value={editableQuery}
                    onChange={(event) => {
                      setEditableQuery(event.target.value);
                      setQueryError(null);
                    }}
                    placeholder={'pickup (Ford OR Ram) "crew cab" !diesel'}
                    aria-invalid={queryError ? true : undefined}
                    aria-describedby="advanced-query-help"
                    className="mt-4 min-h-32 font-mono text-sm"
                  />
                  <p
                    id="advanced-query-help"
                    className="text-muted-foreground mt-3 text-xs leading-5 text-pretty"
                  >
                    Use uppercase OR between alternatives, quotes for an exact
                    phrase, and ! before anything to exclude.
                  </p>
                  {queryError && (
                    <p className="text-destructive mt-2 text-sm" role="alert">
                      {queryError}
                    </p>
                  )}
                </div>

                <div className="mt-5">
                  <Label htmlFor="advanced-sort">Order results by</Label>
                  <Select
                    value={draftFilters.sortBy}
                    onValueChange={(nextSort) =>
                      setDraftFilters((current) => ({
                        ...current,
                        sortBy: nextSort,
                      }))
                    }
                  >
                    <SelectTrigger id="advanced-sort" className="mt-2 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent container={dialogContent}>
                      <SelectGroup>
                        {SEARCH_SORT_OPTIONS.map((option) => (
                          <SelectItem key={option.key} value={option.key}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </section>
            </div>

            <section
              className="mt-10 border-t pt-8"
              aria-labelledby="advanced-refinements-title"
            >
              <h3 id="advanced-refinements-title" className="font-semibold">
                Inventory filters
              </h3>
              <p className="text-muted-foreground mt-1 text-sm text-pretty">
                Choose from all indexed inventory, even when your current search
                has no matches. Saved searches can match future arrivals.
              </p>
              {filterOptionsFeedback}

              <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <FilterPanel title="Make">
                  <SearchableCheckboxList
                    name="advanced-make"
                    label="Make"
                    options={availableFilters.makes}
                    selected={draftFilters.makes}
                    onChange={(nextMakes) =>
                      setDraftFilters((current) => ({
                        ...current,
                        makes: nextMakes,
                      }))
                    }
                    searchPlaceholder="Search makes"
                    maxHeight={150}
                  />
                </FilterPanel>
                <FilterPanel title="Model year">
                  <YearRangeFilter
                    yearRange={draftFilters.yearRange}
                    onYearRangeChange={(nextYearRange) =>
                      setDraftFilters((current) => ({
                        ...current,
                        yearRange: nextYearRange,
                      }))
                    }
                    minimumYear={yearRangeLimits.min}
                    maximumYear={yearRangeLimits.max}
                  />
                </FilterPanel>
                <FilterPanel title="State">
                  <SearchableCheckboxList
                    name="advanced-state"
                    label="State"
                    options={availableFilters.states}
                    selected={draftFilters.states}
                    onChange={(nextStates) =>
                      setDraftFilters((current) => ({
                        ...current,
                        states: nextStates,
                      }))
                    }
                    searchPlaceholder="Search states"
                    maxHeight={150}
                  />
                </FilterPanel>
                <FilterPanel title="Salvage yard">
                  <SearchableCheckboxList
                    name="advanced-yard"
                    label="Salvage yard"
                    options={availableFilters.salvageYards}
                    selected={draftFilters.salvageYards}
                    onChange={(nextYards) =>
                      setDraftFilters((current) => ({
                        ...current,
                        salvageYards: nextYards,
                      }))
                    }
                    searchPlaceholder="Search yards"
                    maxHeight={150}
                  />
                </FilterPanel>
                <FilterPanel title="Color">
                  <SearchableCheckboxList
                    name="advanced-color"
                    label="Color"
                    options={availableFilters.colors}
                    selected={draftFilters.colors}
                    onChange={(nextColors) =>
                      setDraftFilters((current) => ({
                        ...current,
                        colors: nextColors,
                      }))
                    }
                    searchPlaceholder="Search colors"
                    maxHeight={150}
                  />
                </FilterPanel>
                <FilterPanel title="Inventory sources">
                  <InventorySourcesFilter
                    idPrefix="advanced-source"
                    sources={draftFilters.sources}
                    onSourcesChange={(nextSources) =>
                      setDraftFilters((current) => ({
                        ...current,
                        sources: nextSources,
                      }))
                    }
                  />
                </FilterPanel>
              </div>
            </section>
          </div>

          <DialogFooter className="border-t px-6 py-4 sm:items-center sm:justify-between">
            <Button type="button" variant="ghost" onClick={resetDraft}>
              Reset form
            </Button>
            <Button type="submit">
              <Search />
              Search inventory
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

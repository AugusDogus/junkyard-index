"use client";

import { useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import posthog from "posthog-js";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { MobileFilterContent } from "~/components/search/MobileFilterContent";
import {
  loadSearchFilterOptions,
  type SearchFilterOptions,
} from "~/components/search/search-filter-options";
import { SEARCH_SORT_OPTIONS } from "~/components/search/search-routing";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { AnalyticsEvents } from "~/lib/analytics-events";
import type { IngestionSource } from "~/lib/ingestion-source";
import {
  filtersSchema,
  SEARCHABLE_VEHICLE_YEAR_RANGE,
  type SavedSearchFilters,
} from "~/lib/saved-search-filters";
import { resolveSearchCommit } from "~/lib/search-commit";
import { api } from "~/trpc/react";

interface SavedSearchEditorValue {
  id: string;
  name: string;
  query: string;
  filters: SavedSearchFilters;
}

interface EditSavedSearchDialogProps {
  search: SavedSearchEditorValue;
}

interface EditSavedSearchForm {
  name: string;
  searchText: string;
  yearRange: [number, number];
  makes: string[];
  colors: string[];
  states: string[];
  salvageYards: string[];
  sources: IngestionSource[];
  sortBy: string;
}

function clampYear(year: number | undefined, fallback: number): number {
  if (year === undefined) return fallback;
  return Math.min(
    SEARCHABLE_VEHICLE_YEAR_RANGE.max,
    Math.max(SEARCHABLE_VEHICLE_YEAR_RANGE.min, year),
  );
}

function getYearRange(filters: SavedSearchFilters): [number, number] {
  const minimumYear = clampYear(
    filters.minYear,
    SEARCHABLE_VEHICLE_YEAR_RANGE.min,
  );
  const maximumYear = clampYear(
    filters.maxYear,
    SEARCHABLE_VEHICLE_YEAR_RANGE.max,
  );
  return minimumYear <= maximumYear
    ? [minimumYear, maximumYear]
    : [maximumYear, minimumYear];
}

function getSortKey(sortBy: string | undefined): string {
  const option = SEARCH_SORT_OPTIONS.find(
    (candidate) => candidate.key === sortBy || candidate.indexName === sortBy,
  );
  return option?.key ?? "newest";
}

function createForm(search: SavedSearchEditorValue): EditSavedSearchForm {
  return {
    name: search.name,
    searchText: search.filters.vinPattern ?? search.query,
    yearRange: getYearRange(search.filters),
    makes: search.filters.makes ?? [],
    colors: search.filters.colors ?? [],
    states: search.filters.states ?? [],
    salvageYards: search.filters.salvageYards ?? [],
    sources: search.filters.sources ?? [],
    sortBy: getSortKey(search.filters.sortBy),
  };
}

function mergeOptions(options: string[] | undefined, selected: string[]) {
  return [...new Set([...(options ?? []), ...selected])].sort((left, right) =>
    left.localeCompare(right),
  );
}

function buildFilters(form: EditSavedSearchForm, vinPattern?: string) {
  return filtersSchema.safeParse({
    vinPattern,
    minYear: form.yearRange[0],
    maxYear: form.yearRange[1],
    makes: form.makes.length > 0 ? form.makes : undefined,
    colors: form.colors.length > 0 ? form.colors : undefined,
    states: form.states.length > 0 ? form.states : undefined,
    salvageYards: form.salvageYards.length > 0 ? form.salvageYards : undefined,
    sources: form.sources.length > 0 ? form.sources : undefined,
    sortBy: form.sortBy,
  });
}

export function EditSavedSearchDialog({ search }: EditSavedSearchDialogProps) {
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => createForm(search));
  const [formError, setFormError] = useState<string>();
  const filterOptionsQuery = useQuery({
    queryKey: ["saved-search-filter-options"],
    queryFn: loadSearchFilterOptions,
    enabled: open,
    staleTime: Infinity,
  });
  const filterOptions = useMemo<SearchFilterOptions>(
    () => ({
      makes: mergeOptions(filterOptionsQuery.data?.makes, form.makes),
      colors: mergeOptions(filterOptionsQuery.data?.colors, form.colors),
      states: mergeOptions(filterOptionsQuery.data?.states, form.states),
      salvageYards: mergeOptions(
        filterOptionsQuery.data?.salvageYards,
        form.salvageYards,
      ),
    }),
    [
      filterOptionsQuery.data,
      form.makes,
      form.colors,
      form.states,
      form.salvageYards,
    ],
  );

  const updateSearch = api.savedSearches.update.useMutation({
    onSuccess: async (_data, variables) => {
      posthog.capture(AnalyticsEvents.SAVED_SEARCH_UPDATED, {
        search_id: variables.id,
        query: variables.query,
        search_name: variables.name,
        has_sources_filter: (variables.filters.sources?.length ?? 0) > 0,
        source: "settings",
      });
      toast.success("Saved search updated");
      setOpen(false);
      await utils.savedSearches.list.invalidate();
    },
    onError: (error) => {
      setFormError(
        error.message ||
          "The saved search could not be updated. No changes were made. Please try again.",
      );
    },
  });

  const setField = <Key extends keyof EditSavedSearchForm>(
    key: Key,
    value: EditSavedSearchForm[Key],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(undefined);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (updateSearch.isPending) return;
    if (nextOpen) {
      setForm(createForm(search));
      setFormError(undefined);
    }
    setOpen(nextOpen);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setFormError("Enter a name for this saved search.");
      return;
    }

    const searchCommit = resolveSearchCommit(form.searchText, true);
    if (searchCommit.kind === "invalid-vin") {
      setFormError(
        "Enter a complete 17-position VIN pattern or use ordinary search text.",
      );
      return;
    }

    const filtersResult = buildFilters(
      form,
      searchCommit.kind === "vin" ? searchCommit.value : undefined,
    );
    if (!filtersResult.success) {
      setFormError(
        filtersResult.error.issues[0]?.message ??
          "Review the filters and try again.",
      );
      return;
    }

    updateSearch.mutate({
      id: search.id,
      name,
      query: searchCommit.kind === "query" ? searchCommit.value : "",
      filters: filtersResult.data,
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Pencil data-icon="inline-start" />
          Edit filters
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-col overflow-hidden"
        >
          <DialogHeader className="shrink-0 px-6 pt-6 pb-5">
            <DialogTitle>Edit saved search</DialogTitle>
            <DialogDescription>
              Change the search criteria without leaving Settings. Alert
              channels stay enabled.
            </DialogDescription>
          </DialogHeader>

          <div className="scrollbar-thin-themed min-h-0 flex-1 overflow-y-auto overscroll-contain border-y px-6 py-5">
            <FieldGroup className="gap-6">
              <Field>
                <FieldLabel htmlFor={`saved-search-name-${search.id}`}>
                  Name
                </FieldLabel>
                <Input
                  id={`saved-search-name-${search.id}`}
                  value={form.name}
                  maxLength={100}
                  onChange={(event) => setField("name", event.target.value)}
                  disabled={updateSearch.isPending}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor={`saved-search-query-${search.id}`}>
                  Search text or VIN pattern
                </FieldLabel>
                <Input
                  id={`saved-search-query-${search.id}`}
                  value={form.searchText}
                  placeholder="Honda Civic or YV4C*85**********"
                  onChange={(event) =>
                    setField("searchText", event.target.value)
                  }
                  disabled={updateSearch.isPending}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor={`saved-search-sort-${search.id}`}>
                  Sort results
                </FieldLabel>
                <Select
                  value={form.sortBy}
                  onValueChange={(value) => setField("sortBy", value)}
                  disabled={updateSearch.isPending}
                >
                  <SelectTrigger
                    id={`saved-search-sort-${search.id}`}
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {SEARCH_SORT_OPTIONS.map((option) => (
                        <SelectItem key={option.key} value={option.key}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <FieldSet>
                <FieldLegend variant="label">Filters</FieldLegend>
                {filterOptionsQuery.isPending ? (
                  <div className="flex flex-col gap-3" aria-busy="true">
                    <span className="sr-only">Loading filter options</span>
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                  </div>
                ) : (
                  <>
                    {filterOptionsQuery.isError && (
                      <Alert variant="destructive">
                        <AlertTitle>Filter options could not load</AlertTitle>
                        <AlertDescription>
                          <p>
                            Your existing selections are preserved. Retry to
                            load the current inventory options before editing
                            them.
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void filterOptionsQuery.refetch()}
                          >
                            Retry
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}
                    <div className="border-border border-y">
                      <MobileFilterContent
                        idPrefix={`saved-search-${search.id}`}
                        defaultOpenSections="none"
                        containListScroll={false}
                        makes={form.makes}
                        colors={form.colors}
                        states={form.states}
                        salvageYards={form.salvageYards}
                        sources={form.sources}
                        yearRange={form.yearRange}
                        filterOptions={filterOptions}
                        onMakesChange={(makes) => setField("makes", makes)}
                        onColorsChange={(colors) => setField("colors", colors)}
                        onStatesChange={(states) => setField("states", states)}
                        onSalvageYardsChange={(salvageYards) =>
                          setField("salvageYards", salvageYards)
                        }
                        onSourcesChange={(sources) =>
                          setField("sources", sources)
                        }
                        onYearRangeChange={(yearRange) =>
                          setField("yearRange", yearRange)
                        }
                        yearRangeLimits={{
                          min: SEARCHABLE_VEHICLE_YEAR_RANGE.min,
                          max: SEARCHABLE_VEHICLE_YEAR_RANGE.max,
                        }}
                        canUseAdvancedFilters
                      />
                    </div>
                  </>
                )}
              </FieldSet>

              <FieldError>{formError}</FieldError>
            </FieldGroup>
          </div>

          <DialogFooter className="shrink-0 px-6 py-4">
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                disabled={updateSearch.isPending}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={updateSearch.isPending}>
              {updateSearch.isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

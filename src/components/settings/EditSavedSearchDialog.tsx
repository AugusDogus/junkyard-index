"use client";

import { Pencil } from "lucide-react";
import posthog from "posthog-js";
import { useState } from "react";
import { toast } from "sonner";
import { SEARCH_SORT_OPTIONS } from "~/components/search/search-routing";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
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
  FieldDescription,
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
import { Textarea } from "~/components/ui/textarea";
import { AnalyticsEvents } from "~/lib/analytics-events";
import {
  INGESTION_SOURCES,
  INGESTION_SOURCE_DISPLAY_NAMES,
  type IngestionSource,
} from "~/lib/ingestion-source";
import {
  filtersSchema,
  type SavedSearchFilters,
} from "~/lib/saved-search-filters";
import { api } from "~/trpc/react";

const MIN_VEHICLE_YEAR = 1886;
const MAX_VEHICLE_YEAR = new Date().getUTCFullYear() + 1;

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
  query: string;
  vinPattern: string;
  minYear: string;
  maxYear: string;
  makes: string;
  colors: string;
  states: string;
  salvageYards: string;
  sources: IngestionSource[];
  sortBy: string;
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
    query: search.query,
    vinPattern: search.filters.vinPattern ?? "",
    minYear: search.filters.minYear?.toString() ?? "",
    maxYear: search.filters.maxYear?.toString() ?? "",
    makes: search.filters.makes?.join("\n") ?? "",
    colors: search.filters.colors?.join("\n") ?? "",
    states: search.filters.states?.join("\n") ?? "",
    salvageYards: search.filters.salvageYards?.join("\n") ?? "",
    sources: search.filters.sources ?? [],
    sortBy: getSortKey(search.filters.sortBy),
  };
}

function parseList(value: string): string[] | undefined {
  const values = [
    ...new Set(
      value
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  return values.length > 0 ? values : undefined;
}

function parseYear(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const year = Number(value);
  return Number.isInteger(year) ? year : Number.NaN;
}

function buildFilters(form: EditSavedSearchForm) {
  return filtersSchema.safeParse({
    vinPattern: form.vinPattern.trim() || undefined,
    minYear: parseYear(form.minYear),
    maxYear: parseYear(form.maxYear),
    makes: parseList(form.makes),
    colors: parseList(form.colors),
    states: parseList(form.states),
    salvageYards: parseList(form.salvageYards),
    sources: form.sources.length > 0 ? form.sources : undefined,
    sortBy: form.sortBy,
  });
}

function toggleSource(
  selectedSources: IngestionSource[],
  source: IngestionSource,
  checked: boolean,
): IngestionSource[] {
  const explicitSources =
    selectedSources.length > 0 ? selectedSources : [...INGESTION_SOURCES];
  if (
    !checked &&
    selectedSources.length === 1 &&
    selectedSources.includes(source)
  ) {
    return selectedSources;
  }
  const nextSources = checked
    ? [...new Set([...explicitSources, source])]
    : explicitSources.filter((candidate) => candidate !== source);

  return nextSources.length === INGESTION_SOURCES.length ? [] : nextSources;
}

export function EditSavedSearchDialog({ search }: EditSavedSearchDialogProps) {
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => createForm(search));
  const [formError, setFormError] = useState<string>();

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

    const filtersResult = buildFilters(form);
    if (!filtersResult.success) {
      setFormError(
        filtersResult.error.issues[0]?.message ??
          "Review the filters and try again.",
      );
      return;
    }
    if (
      filtersResult.data.minYear !== undefined &&
      filtersResult.data.maxYear !== undefined &&
      filtersResult.data.minYear > filtersResult.data.maxYear
    ) {
      setFormError("The earliest year must be before the latest year.");
      return;
    }

    updateSearch.mutate({
      id: search.id,
      name,
      query: form.query.trim(),
      filters: filtersResult.data,
    });
  };

  const sourceIsChecked = (source: IngestionSource) =>
    form.sources.length === 0 || form.sources.includes(source);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Pencil data-icon="inline-start" />
          Edit filters
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader className="px-6 pt-6 pb-5">
            <DialogTitle>Edit saved search</DialogTitle>
            <DialogDescription>
              Change the search criteria without leaving Settings. Alert
              delivery stays the same.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto border-y px-6 py-5">
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

              <div className="grid gap-6 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`saved-search-query-${search.id}`}>
                    Search text
                  </FieldLabel>
                  <Input
                    id={`saved-search-query-${search.id}`}
                    value={form.query}
                    placeholder="Honda Civic"
                    onChange={(event) => setField("query", event.target.value)}
                    disabled={updateSearch.isPending}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`saved-search-vin-${search.id}`}>
                    VIN pattern
                  </FieldLabel>
                  <Input
                    id={`saved-search-vin-${search.id}`}
                    value={form.vinPattern}
                    placeholder="YV4C*85**********"
                    onChange={(event) =>
                      setField("vinPattern", event.target.value)
                    }
                    disabled={updateSearch.isPending}
                  />
                </Field>
              </div>

              <FieldSet>
                <FieldLegend variant="label">Vehicle year</FieldLegend>
                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor={`saved-search-min-year-${search.id}`}>
                      Earliest
                    </FieldLabel>
                    <Input
                      id={`saved-search-min-year-${search.id}`}
                      type="number"
                      inputMode="numeric"
                      min={MIN_VEHICLE_YEAR}
                      max={MAX_VEHICLE_YEAR}
                      value={form.minYear}
                      placeholder={String(MIN_VEHICLE_YEAR)}
                      onChange={(event) =>
                        setField("minYear", event.target.value)
                      }
                      disabled={updateSearch.isPending}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`saved-search-max-year-${search.id}`}>
                      Latest
                    </FieldLabel>
                    <Input
                      id={`saved-search-max-year-${search.id}`}
                      type="number"
                      inputMode="numeric"
                      min={MIN_VEHICLE_YEAR}
                      max={MAX_VEHICLE_YEAR}
                      value={form.maxYear}
                      placeholder={String(MAX_VEHICLE_YEAR)}
                      onChange={(event) =>
                        setField("maxYear", event.target.value)
                      }
                      disabled={updateSearch.isPending}
                    />
                  </Field>
                </div>
              </FieldSet>

              <FieldSet>
                <FieldLegend variant="label">Vehicle details</FieldLegend>
                <FieldDescription>
                  Enter one value per line. Clear a field to remove that filter.
                </FieldDescription>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor={`saved-search-makes-${search.id}`}>
                      Makes
                    </FieldLabel>
                    <Textarea
                      id={`saved-search-makes-${search.id}`}
                      className="min-h-20 resize-y"
                      value={form.makes}
                      placeholder={"Honda\nToyota"}
                      onChange={(event) =>
                        setField("makes", event.target.value)
                      }
                      disabled={updateSearch.isPending}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`saved-search-colors-${search.id}`}>
                      Colors
                    </FieldLabel>
                    <Textarea
                      id={`saved-search-colors-${search.id}`}
                      className="min-h-20 resize-y"
                      value={form.colors}
                      placeholder={"Black\nSilver"}
                      onChange={(event) =>
                        setField("colors", event.target.value)
                      }
                      disabled={updateSearch.isPending}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`saved-search-states-${search.id}`}>
                      States
                    </FieldLabel>
                    <Textarea
                      id={`saved-search-states-${search.id}`}
                      className="min-h-20 resize-y"
                      value={form.states}
                      placeholder={"California\nNevada"}
                      onChange={(event) =>
                        setField("states", event.target.value)
                      }
                      disabled={updateSearch.isPending}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`saved-search-yards-${search.id}`}>
                      Salvage yards
                    </FieldLabel>
                    <Textarea
                      id={`saved-search-yards-${search.id}`}
                      className="min-h-20 resize-y"
                      value={form.salvageYards}
                      placeholder={
                        "Pick Your Part - Sun Valley\nPick-n-Pull, Sacramento"
                      }
                      onChange={(event) =>
                        setField("salvageYards", event.target.value)
                      }
                      disabled={updateSearch.isPending}
                    />
                  </Field>
                </div>
              </FieldSet>

              <FieldSet>
                <FieldLegend variant="label">Inventory sources</FieldLegend>
                <FieldDescription>
                  Include vehicles from the selected inventory providers.
                </FieldDescription>
                <FieldGroup className="grid gap-2 sm:grid-cols-2">
                  {INGESTION_SOURCES.map((source) => {
                    const checkboxId = `saved-search-source-${search.id}-${source}`;
                    return (
                      <Field
                        key={source}
                        orientation="horizontal"
                        className="hover:bg-muted/60 min-h-9 rounded-md px-2 py-2"
                      >
                        <Checkbox
                          id={checkboxId}
                          checked={sourceIsChecked(source)}
                          onCheckedChange={(checked) =>
                            setField(
                              "sources",
                              toggleSource(
                                form.sources,
                                source,
                                checked === true,
                              ),
                            )
                          }
                          disabled={updateSearch.isPending}
                        />
                        <FieldLabel
                          htmlFor={checkboxId}
                          className="min-w-0 cursor-pointer"
                        >
                          <span className="truncate">
                            {INGESTION_SOURCE_DISPLAY_NAMES[source]}
                          </span>
                        </FieldLabel>
                      </Field>
                    );
                  })}
                </FieldGroup>
              </FieldSet>

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

              <FieldError>{formError}</FieldError>
            </FieldGroup>
          </div>

          <DialogFooter className="px-6 py-4">
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

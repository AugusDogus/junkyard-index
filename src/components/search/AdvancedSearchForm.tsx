"use client";

import { ArrowLeft, LockKeyhole, RotateCcw, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  buildAdvancedSearchUrl,
  readAdvancedSearchDraft,
  type AdvancedSearchDraft,
} from "~/components/search/advanced-search-routing";
import {
  InventorySourcesFilter,
  YearRangeFilter,
} from "~/components/search/FilterFields";
import { SearchableCheckboxList } from "~/components/search/SearchableCheckboxList";
import { SEARCH_SORT_OPTIONS } from "~/components/search/search-routing";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
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
import { Separator } from "~/components/ui/separator";
import { Textarea } from "~/components/ui/textarea";
import {
  buildAdvancedSearchQuery,
  hasAdvancedSearchSyntax,
  parseAdvancedSearchQuery,
  type AdvancedSearchQueryFields,
} from "~/lib/advanced-search-query";
import { PLANS } from "~/lib/plans";
import type { SearchFacetOptions } from "~/lib/search-facet-options";

interface AdvancedSearchFormProps {
  filterOptions: SearchFacetOptions;
  yearLimits: { min: number; max: number };
  canUseAdvancedFilters: boolean;
  booleanOrSearchReady: boolean;
}

const EMPTY_QUERY_FIELDS: AdvancedSearchQueryFields = {
  allWords: "",
  exactPhrase: "",
  anyWords: "",
  excludedWords: "",
};

function initialQueryFields(query: string): AdvancedSearchQueryFields {
  return hasAdvancedSearchSyntax(query)
    ? EMPTY_QUERY_FIELDS
    : { ...EMPTY_QUERY_FIELDS, allWords: query };
}

function mergeOptions(options: string[], selected: string[]) {
  return [...new Set([...selected, ...options])].sort();
}

function QueryField({
  id,
  operator,
  label,
  description,
  placeholder,
  value,
  disabled,
  onChange,
}: {
  id: string;
  operator: string;
  label: string;
  description: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  onChange(value: string): void;
}) {
  return (
    <Field className="grid gap-3 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:items-start">
      <Badge variant="outline" className="mt-7 justify-center font-mono">
        {operator}
      </Badge>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <FieldDescription className="text-pretty">
            {description}
          </FieldDescription>
        </div>
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          disabled={disabled}
        />
      </div>
    </Field>
  );
}

export function AdvancedSearchForm({
  filterOptions,
  yearLimits,
  canUseAdvancedFilters,
  booleanOrSearchReady,
}: AdvancedSearchFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialDraft = useMemo(
    () => readAdvancedSearchDraft(searchParams, yearLimits),
    [searchParams, yearLimits],
  );
  const [draft, setDraft] = useState<AdvancedSearchDraft>(initialDraft);
  const [queryFields, setQueryFields] = useState<AdvancedSearchQueryFields>(
    () => initialQueryFields(initialDraft.query),
  );
  const [usesPowerQuery, setUsesPowerQuery] = useState(() =>
    hasAdvancedSearchSyntax(initialDraft.query),
  );
  const [queryError, setQueryError] = useState<string | null>(null);

  const updateQueryFields = (nextFields: AdvancedSearchQueryFields) => {
    setQueryFields(nextFields);
    setDraft((current) => ({
      ...current,
      query: buildAdvancedSearchQuery(nextFields),
    }));
    setQueryError(null);
  };

  const useFormQuery = () => {
    setDraft((current) => ({
      ...current,
      query: buildAdvancedSearchQuery(queryFields),
    }));
    setUsesPowerQuery(false);
    setQueryError(null);
  };

  const reset = () => {
    setQueryFields(EMPTY_QUERY_FIELDS);
    setDraft({
      query: "",
      makes: [],
      colors: [],
      states: [],
      salvageYards: [],
      sources: [],
      yearRange: [yearLimits.min, yearLimits.max],
      sortBy: "newest",
    });
    setUsesPowerQuery(false);
    setQueryError(null);
  };

  const hasAdvancedFilter =
    canUseAdvancedFilters &&
    (draft.makes.length > 0 ||
      draft.colors.length > 0 ||
      draft.states.length > 0 ||
      draft.salvageYards.length > 0 ||
      draft.sources.length > 0 ||
      draft.yearRange[0] !== yearLimits.min ||
      draft.yearRange[1] !== yearLimits.max);

  const submit = () => {
    const query = draft.query.trim();
    if (!query && !hasAdvancedFilter) {
      setQueryError(
        "Add search words or choose at least one inventory filter.",
      );
      return;
    }

    if (query) {
      const parsed = parseAdvancedSearchQuery(query);
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
    }

    router.push(
      buildAdvancedSearchUrl(
        { ...draft, query },
        yearLimits,
        canUseAdvancedFilters,
      ),
    );
  };

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <Link
        href="/search"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm font-medium"
      >
        <ArrowLeft aria-hidden="true" />
        Back to search
      </Link>

      <header className="mt-8 max-w-3xl">
        <p className="text-muted-foreground text-sm font-medium">
          Search tools
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-balance sm:text-4xl">
          Advanced search
        </h1>
        <p className="text-muted-foreground mt-3 max-w-2xl text-pretty">
          Describe the donor vehicle, narrow the inventory, and review the exact
          query before searching.
        </p>
      </header>

      <form
        className="mt-10"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start">
          <div className="flex min-w-0 flex-col gap-10">
            <FieldSet>
              <FieldLegend>Keywords</FieldLegend>
              <FieldDescription className="max-w-2xl text-pretty">
                Fill in only the rows you need. The form combines them into the
                same syntax accepted by the regular search box.
              </FieldDescription>
              {usesPowerQuery && (
                <div className="bg-muted mt-2 flex flex-col items-start gap-2 rounded-lg px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-muted-foreground text-sm text-pretty">
                    The editable power query is controlling keywords. Inventory
                    filters are still available below.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={useFormQuery}
                  >
                    {draft.query && !buildAdvancedSearchQuery(queryFields)
                      ? "Clear query and use form"
                      : "Restore form query"}
                  </Button>
                </div>
              )}
              <FieldGroup className="mt-2 gap-6">
                <QueryField
                  id="advanced-all-words"
                  operator="AND"
                  label="All of these words"
                  description="Every word must appear somewhere in the vehicle record."
                  placeholder="pickup truck"
                  value={queryFields.allWords}
                  disabled={usesPowerQuery}
                  onChange={(allWords) =>
                    updateQueryFields({ ...queryFields, allWords })
                  }
                />
                <QueryField
                  id="advanced-exact-phrase"
                  operator={'" "'}
                  label="This exact phrase"
                  description="Words must stay together within one field, such as a model name."
                  placeholder="Grand Cherokee"
                  value={queryFields.exactPhrase}
                  disabled={usesPowerQuery}
                  onChange={(exactPhrase) =>
                    updateQueryFields({ ...queryFields, exactPhrase })
                  }
                />
                <QueryField
                  id="advanced-any-words"
                  operator="OR"
                  label="Any of these words"
                  description="Separate interchangeable alternatives with commas."
                  placeholder="Ford, Chevrolet, Ram"
                  value={queryFields.anyWords}
                  disabled={usesPowerQuery}
                  onChange={(anyWords) =>
                    updateQueryFields({ ...queryFields, anyWords })
                  }
                />
                <QueryField
                  id="advanced-excluded-words"
                  operator="NOT"
                  label="None of these words"
                  description="Exclude records containing any of these words."
                  placeholder="diesel, damaged"
                  value={queryFields.excludedWords}
                  disabled={usesPowerQuery}
                  onChange={(excludedWords) =>
                    updateQueryFields({ ...queryFields, excludedWords })
                  }
                />
              </FieldGroup>
            </FieldSet>

            <Separator />

            {canUseAdvancedFilters ? (
              <>
                <FieldSet>
                  <FieldLegend>Vehicle details</FieldLegend>
                  <FieldDescription className="max-w-2xl text-pretty">
                    Select more than one value to broaden that part of the
                    search.
                  </FieldDescription>
                  <FieldGroup className="mt-2 grid gap-6 md:grid-cols-2">
                    <Field className="rounded-lg border p-4">
                      <FieldLabel>Make</FieldLabel>
                      <SearchableCheckboxList
                        name="advanced-make"
                        label="Make"
                        options={mergeOptions(filterOptions.makes, draft.makes)}
                        selected={draft.makes}
                        onChange={(makes) =>
                          setDraft((current) => ({ ...current, makes }))
                        }
                        searchPlaceholder="Search makes"
                        maxHeight={220}
                      />
                    </Field>
                    <Field className="rounded-lg border p-4">
                      <FieldLabel>Model year</FieldLabel>
                      <FieldDescription>
                        Include vehicles within this range.
                      </FieldDescription>
                      <YearRangeFilter
                        yearRange={draft.yearRange}
                        onYearRangeChange={(yearRange) =>
                          setDraft((current) => ({ ...current, yearRange }))
                        }
                        minimumYear={yearLimits.min}
                        maximumYear={yearLimits.max}
                      />
                    </Field>
                  </FieldGroup>
                </FieldSet>

                <Separator />

                <FieldSet>
                  <FieldLegend>Inventory and location</FieldLegend>
                  <FieldDescription className="max-w-2xl text-pretty">
                    Limit the search to the yards and inventory networks you can
                    use.
                  </FieldDescription>
                  <FieldGroup className="mt-2 grid gap-6 md:grid-cols-2">
                    <Field className="rounded-lg border p-4">
                      <FieldLabel>State or province</FieldLabel>
                      <SearchableCheckboxList
                        name="advanced-state"
                        label="State or province"
                        options={mergeOptions(
                          filterOptions.states,
                          draft.states,
                        )}
                        selected={draft.states}
                        onChange={(states) =>
                          setDraft((current) => ({ ...current, states }))
                        }
                        searchPlaceholder="Search states"
                        maxHeight={220}
                      />
                    </Field>
                    <Field className="rounded-lg border p-4">
                      <FieldLabel>Salvage yard</FieldLabel>
                      <SearchableCheckboxList
                        name="advanced-yard"
                        label="Salvage yard"
                        options={mergeOptions(
                          filterOptions.salvageYards,
                          draft.salvageYards,
                        )}
                        selected={draft.salvageYards}
                        onChange={(salvageYards) =>
                          setDraft((current) => ({ ...current, salvageYards }))
                        }
                        searchPlaceholder="Search yards"
                        maxHeight={220}
                      />
                    </Field>
                    <Field className="rounded-lg border p-4">
                      <FieldLabel>Color</FieldLabel>
                      <SearchableCheckboxList
                        name="advanced-color"
                        label="Color"
                        options={mergeOptions(
                          filterOptions.colors,
                          draft.colors,
                        )}
                        selected={draft.colors}
                        onChange={(colors) =>
                          setDraft((current) => ({ ...current, colors }))
                        }
                        searchPlaceholder="Search colors"
                        maxHeight={220}
                      />
                    </Field>
                    <Field className="rounded-lg border p-4">
                      <FieldLabel>Inventory sources</FieldLabel>
                      <InventorySourcesFilter
                        idPrefix="advanced-source"
                        sources={draft.sources}
                        onSourcesChange={(sources) =>
                          setDraft((current) => ({ ...current, sources }))
                        }
                      />
                    </Field>
                  </FieldGroup>
                </FieldSet>
              </>
            ) : (
              <Alert>
                <LockKeyhole aria-hidden="true" />
                <AlertTitle>Inventory filters require Lite</AlertTitle>
                <AlertDescription>
                  <p className="text-pretty">
                    Add make, year, state, yard, color, and source filters from
                    ${PLANS.lite.monthlyPrice}/month. Boolean keyword search is
                    available on every plan.
                  </p>
                  <Button asChild size="sm" variant="outline" className="mt-4">
                    <Link href="/pricing">Compare plans</Link>
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <Separator />

            <FieldSet>
              <FieldLegend>Results</FieldLegend>
              <FieldDescription className="max-w-2xl text-pretty">
                Choose how matching vehicles should be ordered.
              </FieldDescription>
              <FieldGroup className="mt-2 max-w-sm">
                <Field>
                  <FieldLabel htmlFor="advanced-sort">
                    Order results by
                  </FieldLabel>
                  <Select
                    value={draft.sortBy}
                    onValueChange={(sortBy) =>
                      setDraft((current) => ({ ...current, sortBy }))
                    }
                  >
                    <SelectTrigger id="advanced-sort" className="w-full">
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
              </FieldGroup>
            </FieldSet>
          </div>

          <aside className="xl:sticky xl:top-24">
            <Card>
              <CardHeader className="border-b">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>Your search query</CardTitle>
                  <Badge variant="secondary">Editable</Badge>
                </div>
                <CardDescription className="text-pretty">
                  This is the exact expression sent to search and stored in the
                  shareable URL.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Field data-invalid={queryError ? true : undefined}>
                  <FieldLabel htmlFor="advanced-query">Power query</FieldLabel>
                  <Textarea
                    id="advanced-query"
                    value={draft.query}
                    onChange={(event) => {
                      setDraft((current) => ({
                        ...current,
                        query: event.target.value,
                      }));
                      setUsesPowerQuery(true);
                      setQueryError(null);
                    }}
                    placeholder={'pickup (Ford OR Ram) "crew cab" !diesel'}
                    aria-invalid={queryError ? true : undefined}
                    className="min-h-36 font-mono text-sm"
                  />
                  <FieldDescription className="text-pretty">
                    Use uppercase OR, quotes for a phrase, and ! to exclude a
                    word. You can also type this directly on the regular search
                    page.
                  </FieldDescription>
                  {queryError && <FieldError>{queryError}</FieldError>}
                </Field>
              </CardContent>
              <CardFooter className="flex-col gap-2 border-t">
                <Button type="submit" className="w-full">
                  <Search data-icon="inline-start" />
                  Search inventory
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={reset}
                >
                  <RotateCcw data-icon="inline-start" />
                  Clear all
                </Button>
              </CardFooter>
            </Card>
          </aside>
        </div>
      </form>
    </main>
  );
}

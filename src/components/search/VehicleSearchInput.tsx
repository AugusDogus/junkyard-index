"use client";

import { Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchBox } from "react-instantsearch";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  hasAdvancedSearchSyntax,
  parseAdvancedSearchQuery,
} from "~/lib/advanced-search-query";
import { cn } from "~/lib/utils";
import {
  executeSearchCommit,
  resolveCommittedSearchSync,
} from "~/lib/search-commit";
import { VinPattern } from "~/lib/vin-pattern";

const DEBOUNCE_MS = 300;

interface VehicleSearchInputProps {
  vinPattern: string;
  vinPatternSearchReady: boolean;
  booleanOrSearchReady: boolean;
  onSearchModeChange: (value: {
    query: string | null;
    vinPattern: string | null;
  }) => Promise<void>;
}

export function VehicleSearchInput({
  vinPattern,
  vinPatternSearchReady,
  booleanOrSearchReady,
  onSearchModeChange,
}: VehicleSearchInputProps) {
  const { query, refine } = useSearchBox();
  const refineRef = useRef(refine);
  const committedValue =
    vinPatternSearchReady && vinPattern ? vinPattern : query;
  const [inputValue, setInputValue] = useState(committedValue);
  const inputValueRef = useRef(inputValue);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committingValueRef = useRef<string | null>(null);

  useEffect(() => {
    refineRef.current = refine;
  }, [refine]);

  useEffect(() => {
    inputValueRef.current = inputValue;
  }, [inputValue]);

  useEffect(() => {
    const sync = resolveCommittedSearchSync({
      committedValue,
      pendingValue: committingValueRef.current,
      inputValue: inputValueRef.current,
    });
    if (sync.kind === "wait") return;
    if (sync.clearPending) committingValueRef.current = null;
    if (sync.inputValue !== null) setInputValue(sync.inputValue);
  }, [committedValue]);

  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  useEffect(() => {
    if (committingValueRef.current !== null) return;
    if (!urlQuery && inputValueRef.current) {
      setInputValue("");
      void onSearchModeChange({ query: null, vinPattern: null });
      refine("");
    }
  }, [onSearchModeChange, refine, urlQuery]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const isVinCandidate =
    vinPatternSearchReady && VinPattern.isSearchCandidate(inputValue);
  const parsedVinPattern = useMemo(
    () => (isVinCandidate ? VinPattern.parse(inputValue) : null),
    [inputValue, isVinCandidate],
  );
  const vinPatternError =
    parsedVinPattern &&
    !parsedVinPattern.success &&
    (parsedVinPattern.error.type !== "wrong_length" ||
      parsedVinPattern.error.positions > VinPattern.length)
      ? VinPattern.errorMessage(parsedVinPattern.error)
      : parsedVinPattern?.success &&
          !VinPattern.toAlgoliaFilter(parsedVinPattern.data)
        ? "Add at least one known VIN character."
        : undefined;
  const vinPatternFeedback = (() => {
    if (!parsedVinPattern) return null;
    if (vinPatternError) return vinPatternError;
    if (!parsedVinPattern.success) {
      return parsedVinPattern.error.type === "wrong_length" &&
        parsedVinPattern.error.positions <= VinPattern.length
        ? `${parsedVinPattern.error.positions} of ${VinPattern.length} VIN positions. Use * for anything unknown.`
        : VinPattern.errorMessage(parsedVinPattern.error);
    }
    return inputValue.includes("*") || inputValue.includes("[")
      ? "VIN pattern ready."
      : "Exact VIN detected.";
  })();
  const advancedSearchParseResult = useMemo(
    () => parseAdvancedSearchQuery(inputValue),
    [inputValue],
  );
  const advancedSearchError =
    !isVinCandidate && !advancedSearchParseResult.success
      ? advancedSearchParseResult.error
      : !isVinCandidate &&
          advancedSearchParseResult.success &&
          advancedSearchParseResult.data.anyWordGroups.length > 0 &&
          !booleanOrSearchReady
        ? "Boolean OR search is temporarily unavailable while the search index updates."
        : undefined;
  const searchError = vinPatternError ?? advancedSearchError;
  const searchFeedback =
    vinPatternFeedback ??
    (hasAdvancedSearchSyntax(inputValue) && advancedSearchParseResult.success
      ? "Advanced query ready."
      : null);
  const displayedFeedback = searchError ?? searchFeedback;

  const commitSearchValue = useCallback(
    async (value: string) => {
      const parsedQuery = parseAdvancedSearchQuery(value);
      if (
        !parsedQuery.success ||
        (parsedQuery.data.anyWordGroups.length > 0 && !booleanOrSearchReady)
      ) {
        return;
      }
      await executeSearchCommit({
        value,
        vinPatternSearchReady,
        currentVinPattern: vinPattern,
        operations: {
          setPendingValue: (pendingValue) => {
            committingValueRef.current = pendingValue;
          },
          changeMode: onSearchModeChange,
          refine: (queryValue) => refineRef.current(queryValue),
        },
      });
    },
    [
      booleanOrSearchReady,
      onSearchModeChange,
      vinPattern,
      vinPatternSearchReady,
    ],
  );

  const clearSearch = useCallback(() => {
    setInputValue("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void commitSearchValue("");
    document.getElementById("search")?.focus();
  }, [commitSearchValue]);

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void commitSearchValue(inputValueRef.current);
    },
    [commitSearchValue],
  );

  return (
    <form role="search" onSubmit={handleSubmit} className="min-w-0 flex-1">
      <label className="sr-only" htmlFor="search">
        Search by year, make, model, or VIN
      </label>
      <div className="group relative">
        <Search
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          id="search"
          type="text"
          role="searchbox"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          value={inputValue}
          onChange={(event) => {
            const value = event.target.value;
            setInputValue(value);
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(
              () => void commitSearchValue(value),
              DEBOUNCE_MS,
            );
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (debounceRef.current) clearTimeout(debounceRef.current);
            void commitSearchValue(inputValueRef.current);
          }}
          placeholder="Search year, make, model, or VIN"
          aria-describedby={
            displayedFeedback ? "search-query-feedback" : "search-hint"
          }
          aria-invalid={searchError ? true : undefined}
          className={cn(
            "h-11 pr-11 pl-10 text-base md:h-9 md:text-sm",
            searchError &&
              "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20",
          )}
        />
        {inputValue && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear search"
            onClick={clearSearch}
            className="absolute top-1/2 right-0 size-11 -translate-y-1/2 md:right-1 md:size-7"
          >
            <X />
          </Button>
        )}
      </div>
      <p id="search-hint" className="sr-only">
        Results update as you type. Press Command K or Control K to focus this
        field.
      </p>
      {displayedFeedback && (
        <p
          id="search-query-feedback"
          role={searchError ? "alert" : "status"}
          aria-live="polite"
          className={cn(
            "mt-2 px-1 text-xs text-pretty",
            searchError ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {displayedFeedback}
        </p>
      )}
    </form>
  );
}

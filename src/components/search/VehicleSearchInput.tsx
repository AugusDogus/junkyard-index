"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchBox } from "react-instantsearch";
import { SearchField } from "~/components/search/SearchField";
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
  onSearchModeChange: (value: {
    query: string | null;
    vinPattern: string | null;
  }) => Promise<void>;
}

export function VehicleSearchInput({
  vinPattern,
  vinPatternSearchReady,
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

  const commitSearchValue = useCallback(
    async (value: string) => {
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
    [onSearchModeChange, vinPattern, vinPatternSearchReady],
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
    <form role="search" onSubmit={handleSubmit} className="w-full min-w-0">
      <label className="sr-only" htmlFor="search">
        Search by year, make, model, or VIN
      </label>
      <SearchField
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
          vinPatternFeedback ? "search-vin-feedback" : "search-hint"
        }
        aria-invalid={vinPatternError ? true : undefined}
        onClear={clearSearch}
        className={cn(
          vinPatternError &&
            "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20",
        )}
      />
      <p id="search-hint" className="sr-only">
        Results update as you type. Press Command K or Control K to focus this
        field.
      </p>
      {vinPatternFeedback && (
        <p
          id="search-vin-feedback"
          role={vinPatternError ? "alert" : "status"}
          aria-live="polite"
          className={cn(
            "mt-2 px-1 text-xs text-pretty",
            vinPatternError ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {vinPatternFeedback}
        </p>
      )}
    </form>
  );
}

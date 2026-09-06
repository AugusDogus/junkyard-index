"use client";

import { LockKeyhole, Search } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { SearchCriteriaFields } from "~/components/search/SearchCriteriaFields";
import { SearchEditorContent } from "~/components/search/SearchEditorContent";
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
import { FieldError } from "~/components/ui/field";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";
import { parseAdvancedSearchQuery } from "~/lib/advanced-search-query";
import { InventoryFilterOptions } from "~/lib/inventory-filter-options";
import { SearchCriteria } from "~/lib/search-criteria";
import { cn } from "~/lib/utils";

export type AdvancedSearchSubmission = SearchCriteria;

interface AdvancedSearchDialogProps extends Omit<SearchCriteria, "queryMode"> {
  filterOptions: InventoryFilterOptions | undefined;
  filterOptionsFeedback?: ReactNode;
  canUseAdvancedFilters: boolean;
  booleanOrSearchReady: boolean;
  vinPatternSearchReady?: boolean;
  triggerClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
  onSearch: (submission: AdvancedSearchSubmission) => void;
}

function AdvancedSearchForm({
  onClose,
  ...props
}: AdvancedSearchDialogProps & { onClose: () => void }) {
  const [value, setValue] = useState<SearchCriteria>(() => ({
    query: props.query,
    queryMode: SearchCriteria.fromSavedSearch(props.query, {}).queryMode,
    makes: props.makes,
    colors: props.colors,
    states: props.states,
    salvageYards: props.salvageYards,
    sources: props.sources,
    yearRange: props.yearRange,
    sortBy: props.sortBy,
  }));
  const [error, setError] = useState<string>();
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  return (
    <SearchEditorContent ref={setContent}>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = SearchCriteria.toSavedSearch(value);
          if (!parsed.success) {
            setError(parsed.error);
            return;
          }
          const query = parseAdvancedSearchQuery(parsed.data.query);
          if (
            query.success &&
            query.data.anyWordGroups.length > 0 &&
            !props.booleanOrSearchReady
          ) {
            setError(
              "Boolean OR search is temporarily unavailable while the search index updates.",
            );
            return;
          }
          if (
            parsed.data.filters.vinPattern &&
            props.vinPatternSearchReady === false
          ) {
            setError(
              "VIN pattern search is temporarily unavailable. Please try again later.",
            );
            return;
          }
          props.onSearch({
            ...value,
            query: parsed.data.filters.vinPattern ?? parsed.data.query,
          });
          onClose();
        }}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12 text-left sm:px-6">
          <DialogTitle>Advanced search</DialogTitle>
          <DialogDescription>
            Describe the vehicle you want to find. You can save the search for
            future arrivals.
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-thin-themed min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-6">
          <SearchCriteriaFields
            value={value}
            onChange={(next) => {
              setValue(next);
              setError(undefined);
            }}
            filterOptions={InventoryFilterOptions.withSelected(
              props.filterOptions,
              props,
            )}
            filterOptionsFeedback={props.filterOptionsFeedback}
            portalContainer={content}
          />
        </div>
        <div className="shrink-0 border-t px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          {error && (
            <FieldError className="mb-3" role="alert">
              {error}
            </FieldError>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              <Search data-icon="inline-start" />
              Search inventory
            </Button>
          </DialogFooter>
        </div>
      </form>
    </SearchEditorContent>
  );
}

export function AdvancedSearchDialog(props: AdvancedSearchDialogProps) {
  const {
    canUseAdvancedFilters,
    triggerClassName,
    open: controlledOpen,
    onOpenChange,
    showTrigger = true,
  } = props;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
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
      {open && <AdvancedSearchForm {...props} onClose={() => setOpen(false)} />}
    </Dialog>
  );
}

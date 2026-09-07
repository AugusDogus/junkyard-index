"use client";

import { LockKeyhole, Search } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { SearchTerms } from "~/components/search/editor/QueryView";
import { SortField } from "~/components/search/editor/controls";
import { EditorPortal } from "~/components/search/editor/EditorPortal";
import { BuilderEdits } from "~/components/search/editor/BuilderEdits";
import { FilterSuggestions } from "~/components/search/editor/FilterSuggestions";
import {
  savedSearchDraft,
  serializeSavedSearchDraft,
} from "~/lib/saved-search-draft";
import { compileSearchExpression } from "~/lib/compile-search-expression";
import type { SavedSearchFilters } from "~/lib/saved-search-filters";
import "~/components/search/editor/editor.css";
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
import type { SearchCriteria } from "~/lib/search-criteria";
import { cn } from "~/lib/utils";

export type AdvancedSearchSubmission = {
  query: string;
  filters: SavedSearchFilters;
};

interface AdvancedSearchDialogProps extends Omit<SearchCriteria, "queryMode"> {
  expression?: string;
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
  const [draft, setDraft] = useState(() =>
    savedSearchDraft({
      id: "new",
      name: "",
      query: props.query,
      filters: {
        expression: props.expression,
        makes: props.makes,
        colors: props.colors,
        states: props.states,
        salvageYards: props.salvageYards,
        sources: props.sources,
        minYear: props.yearRange[0],
        maxYear: props.yearRange[1],
        sortBy: props.sortBy,
      },
      emailAlertsEnabled: false,
      discordAlertsEnabled: false,
    }),
  );
  const [pending, setPending] = useState(0);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState<string>();
  return (
    <SearchEditorContent ref={setContent}>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) {
            setError(
              "Apply or cancel the condition you are editing before searching.",
            );
            return;
          }
          const parsed = serializeSavedSearchDraft(draft);
          if (!parsed.success) {
            setError(parsed.error);
            return;
          }
          const query = parseAdvancedSearchQuery(parsed.data.query);
          const expression =
            parsed.data.filters.expression === undefined
              ? null
              : compileSearchExpression(parsed.data.filters.expression);
          if (
            ((query.success && query.data.anyWordGroups.length > 0) ||
              (expression?.success && expression.data.requiresTokens)) &&
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
          props.onSearch(parsed.data);
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
          <EditorPortal value={content}>
            <BuilderEdits value={{ pending, setPending }}>
              <FilterSuggestions
                value={InventoryFilterOptions.withSelected(
                  props.filterOptions,
                  draft.criteria,
                )}
              >
                <div className="se-workspace se-stack">
                  <SearchTerms
                    draft={draft}
                    onChange={(next) => {
                      setDraft(next);
                      setError(undefined);
                    }}
                  />
                  <SortField
                    value={draft.criteria}
                    onChange={(criteria) => setDraft({ ...draft, criteria })}
                  />
                  {props.filterOptionsFeedback}
                </div>
              </FilterSuggestions>
            </BuilderEdits>
          </EditorPortal>
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

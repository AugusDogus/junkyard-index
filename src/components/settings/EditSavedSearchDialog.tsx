"use client";

import { Pencil } from "lucide-react";
import posthog from "posthog-js";
import { useState } from "react";
import { toast } from "sonner";
import { InventoryFilterFeedback } from "~/components/search/InventoryFilterFeedback";
import { SearchCriteriaFields } from "~/components/search/SearchCriteriaFields";
import { SearchEditorContent } from "~/components/search/SearchEditorContent";
import { Button } from "~/components/ui/button";
import {
  Dialog,
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
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { useInventoryFilterOptions } from "~/hooks/use-inventory-filter-options";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { InventoryFilterOptions } from "~/lib/inventory-filter-options";
import type { SavedSearchFilters } from "~/lib/saved-search-filters";
import { SearchCriteria } from "~/lib/search-criteria";
import { api } from "~/trpc/react";

interface EditSavedSearchDialogProps {
  search: {
    id: string;
    name: string;
    query: string;
    filters: SavedSearchFilters;
  };
  source?: "settings" | "saved_searches_list";
}

function EditSavedSearchForm({
  search,
  source,
  onClose,
  onPendingChange,
}: EditSavedSearchDialogProps & {
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const utils = api.useUtils();
  const [name, setName] = useState(search.name);
  const [value, setValue] = useState(() =>
    SearchCriteria.fromSavedSearch(search.query, search.filters),
  );
  const [error, setError] = useState<string>();
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const options = useInventoryFilterOptions(true);
  const available = InventoryFilterOptions.withSelected(
    options.data,
    SearchCriteria.fromSavedSearch(search.query, search.filters),
  );
  const update = api.savedSearches.update.useMutation({
    onMutate: () => onPendingChange(true),
    onSuccess: (_data, variables) => {
      posthog.capture(AnalyticsEvents.SAVED_SEARCH_UPDATED, {
        search_id: variables.id,
        has_query: variables.query.trim().length > 0,
        has_sources_filter: (variables.filters.sources?.length ?? 0) > 0,
        source,
      });
      toast.success("Saved search updated");
      void utils.savedSearches.list.invalidate();
      onClose();
    },
    onError: (cause) =>
      setError(
        cause.message ||
          "Changes could not be saved. Your previous search is preserved. Please try again.",
      ),
    onSettled: () => onPendingChange(false),
  });
  return (
    <SearchEditorContent ref={setContent}>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) {
            setError("Enter a name for this saved search.");
            return;
          }
          const parsed = SearchCriteria.toSavedSearch(value);
          if (!parsed.success) {
            setError(parsed.error);
            return;
          }
          update.mutate({ id: search.id, name: name.trim(), ...parsed.data });
        }}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12 text-left sm:px-6">
          <DialogTitle>Edit saved search</DialogTitle>
          <DialogDescription>
            Update what you want to find. Your notification settings stay the
            same.
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-thin-themed min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-6">
          <fieldset disabled={update.isPending} className="min-w-0">
            <FieldGroup>
              <Field className="max-w-md">
                <FieldLabel htmlFor={`search-name-${search.id}`}>
                  Search name
                </FieldLabel>
                <Input
                  id={`search-name-${search.id}`}
                  value={name}
                  maxLength={100}
                  onChange={(event) => {
                    setName(event.target.value);
                    setError(undefined);
                  }}
                />
              </Field>
              <SearchCriteriaFields
                value={value}
                onChange={(next) => {
                  setValue(next);
                  setError(undefined);
                }}
                filterOptions={available}
                portalContainer={content}
                filterOptionsFeedback={
                  <InventoryFilterFeedback
                    isPending={options.isPending}
                    isError={options.isError}
                    retry={() => void options.refetch()}
                  />
                }
              />
            </FieldGroup>
          </fieldset>
        </div>
        <div className="shrink-0 border-t px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          {error && (
            <FieldError role="alert" className="mb-3">
              {error}
            </FieldError>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={update.isPending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </div>
      </form>
    </SearchEditorContent>
  );
}

export function EditSavedSearchDialog({
  search,
  source = "settings",
}: EditSavedSearchDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Edit saved search ${search.name}`}
        >
          <Pencil data-icon="inline-start" />
          Edit
        </Button>
      </DialogTrigger>
      {open && (
        <EditSavedSearchForm
          search={search}
          source={source}
          onClose={() => setOpen(false)}
          onPendingChange={setPending}
        />
      )}
    </Dialog>
  );
}

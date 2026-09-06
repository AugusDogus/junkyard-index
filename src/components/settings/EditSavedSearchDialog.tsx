"use client";

import posthog from "posthog-js";
import Link from "next/link";
import { Tabs } from "radix-ui";
import { DeleteSavedSearchDialog } from "~/components/search/DeleteSavedSearchDialog";
import { SavedSearchAlerts } from "~/components/search/SavedSearchAlerts";
import { useAlertSubscriptionAccess } from "~/hooks/use-alert-subscription-access";
import { useState } from "react";
import { toast } from "sonner";
import { InventoryFilterFeedback } from "~/components/search/InventoryFilterFeedback";
import { SearchCriteriaFields } from "~/components/search/SearchCriteriaFields";
import { SearchEditorContent } from "~/components/search/SearchEditorContent";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
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
    emailAlertsEnabled: boolean;
    discordAlertsEnabled: boolean;
  };
  source?: "settings" | "saved_searches_list";
  locked?: boolean;
}

function EditSavedSearchForm({
  search,
  source,
  onClose,
  onPendingChange,
  locked,
}: EditSavedSearchDialogProps & {
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const utils = api.useUtils();
  const [name, setName] = useState(search.name);
  const [value, setValue] = useState(() =>
    SearchCriteria.fromSavedSearch(search.query, search.filters),
  );
  const [tab, setTab] = useState<"criteria" | "alerts">("criteria");
  const [error, setError] = useState<string>();
  const [emailEnabled, setEmailEnabled] = useState(search.emailAlertsEnabled);
  const [discordEnabled, setDiscordEnabled] = useState(
    search.discordAlertsEnabled,
  );
  const { canAttemptAlertInteraction, openAlertUpgrade } =
    useAlertSubscriptionAccess(source ?? "settings");
  const { data: notifications, isPending: notificationsPending } =
    api.user.getNotificationSettings.useQuery();
  const remove = api.savedSearches.delete.useMutation({
    onMutate: () => onPendingChange(true),
    onSuccess: () => {
      posthog.capture(AnalyticsEvents.SAVED_SEARCH_DELETED, {
        search_id: search.id,
        source,
      });
      void utils.savedSearches.list.invalidate();
      toast.success("Search deleted");
      onClose();
    },
    onSettled: () => onPendingChange(false),
  });
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
      for (const channel of [
        {
          key: "emailAlertsEnabled",
          event: AnalyticsEvents.SAVED_SEARCH_EMAIL_TOGGLED,
        },
        {
          key: "discordAlertsEnabled",
          event: AnalyticsEvents.SAVED_SEARCH_DISCORD_TOGGLED,
        },
      ] as const) {
        const enabled = variables[channel.key];
        if (enabled !== undefined)
          posthog.capture(channel.event, {
            search_id: variables.id,
            enabled,
            source,
          });
      }
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
    <SearchEditorContent
      ref={setContent}
      className="sm:h-[min(48rem,calc(100dvh-2rem))]"
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) {
            setTab("criteria");
            setError("Enter a name for this saved search.");
            return;
          }
          const parsed = SearchCriteria.toSavedSearch(value);
          if (!parsed.success) {
            setTab("criteria");
            setError(parsed.error);
            return;
          }
          update.mutate({
            id: search.id,
            name: name.trim(),
            ...parsed.data,
            ...(emailEnabled !== search.emailAlertsEnabled
              ? { emailAlertsEnabled: emailEnabled }
              : {}),
            ...(discordEnabled !== search.discordAlertsEnabled
              ? { discordAlertsEnabled: discordEnabled }
              : {}),
          });
        }}
      >
        <Tabs.Root
          value={tab}
          onValueChange={(value) => {
            if (value === "criteria" || value === "alerts") setTab(value);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12 text-left sm:px-6">
            <DialogTitle>Edit saved search</DialogTitle>
            <DialogDescription>{search.name}</DialogDescription>
          </DialogHeader>
          <Tabs.List
            aria-label="Saved search settings"
            className="flex shrink-0 gap-6 border-b px-5 sm:px-6"
          >
            <Tabs.Trigger
              value="criteria"
              className="text-muted-foreground focus-visible:ring-ring data-[state=active]:border-foreground data-[state=active]:text-foreground min-h-11 border-b-2 border-transparent text-sm font-medium outline-none focus-visible:ring-2"
            >
              Search criteria
            </Tabs.Trigger>
            <Tabs.Trigger
              value="alerts"
              className="text-muted-foreground focus-visible:ring-ring data-[state=active]:border-foreground data-[state=active]:text-foreground min-h-11 border-b-2 border-transparent text-sm font-medium outline-none focus-visible:ring-2"
            >
              Alerts
            </Tabs.Trigger>
          </Tabs.List>
          <div className="scrollbar-thin-themed min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-6">
            {locked && (
              <p className="text-muted-foreground mb-4 text-sm">
                Upgrade to Lite to edit this search. You can still delete it
                below.
              </p>
            )}
            <Tabs.Content
              value="criteria"
              forceMount
              className="data-[state=inactive]:hidden"
            >
              <fieldset
                disabled={locked || update.isPending || remove.isPending}
                className="min-w-0"
              >
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
            </Tabs.Content>
            <Tabs.Content
              value="alerts"
              forceMount
              className="data-[state=inactive]:hidden"
            >
              <div className="max-w-md">
                <h3 className="font-medium text-balance">
                  Notify me about new matches
                </h3>
                <p className="text-muted-foreground mt-2 mb-5 text-sm text-pretty">
                  Choose where alerts for this search arrive. Changes take
                  effect when you save.
                </p>
                <SavedSearchAlerts
                  searchName={search.name}
                  emailEnabled={emailEnabled}
                  discordEnabled={discordEnabled}
                  disabled={
                    Boolean(locked) ||
                    update.isPending ||
                    remove.isPending ||
                    notificationsPending
                  }
                  onEmailChange={(enabled) => {
                    if (enabled && !canAttemptAlertInteraction) {
                      void openAlertUpgrade();
                      return;
                    }
                    setEmailEnabled(enabled);
                    setError(undefined);
                  }}
                  onDiscordChange={(enabled) => {
                    if (enabled && !canAttemptAlertInteraction) {
                      void openAlertUpgrade();
                      return;
                    }
                    if (
                      enabled &&
                      (!notifications?.hasDiscordLinked ||
                        !notifications.discordAppInstalled)
                    ) {
                      setError(
                        "Set up Discord in notification settings before enabling alerts.",
                      );
                      return;
                    }
                    setDiscordEnabled(enabled);
                    setError(undefined);
                  }}
                />
                <Link
                  href="/settings/notifications"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground mt-5 inline-block py-2 text-sm underline underline-offset-4"
                >
                  Notification setup (opens a new tab)
                </Link>
              </div>
            </Tabs.Content>
          </div>
        </Tabs.Root>
        <div className="shrink-0 border-t px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          {error && (
            <FieldError role="alert" className="mb-3">
              {error}
            </FieldError>
          )}
          <div className="flex items-center justify-between gap-2">
            <DeleteSavedSearchDialog
              searchName={search.name}
              disabled={update.isPending || remove.isPending}
              onDelete={() => remove.mutateAsync({ id: search.id })}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={update.isPending || remove.isPending}
                onClick={onClose}
              >
                Cancel
              </Button>
              {!locked && (
                <Button
                  type="submit"
                  className="min-h-11"
                  disabled={update.isPending || remove.isPending}
                >
                  {update.isPending ? "Saving…" : "Save changes"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </form>
    </SearchEditorContent>
  );
}

export function EditSavedSearchDialog({
  search,
  source = "settings",
  locked = false,
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
          className="min-h-11"
          aria-label={`Edit saved search ${search.name}`}
        >
          Edit
        </Button>
      </DialogTrigger>
      {open && (
        <EditSavedSearchForm
          search={search}
          source={source}
          locked={locked}
          onClose={() => setOpen(false)}
          onPendingChange={setPending}
        />
      )}
    </Dialog>
  );
}

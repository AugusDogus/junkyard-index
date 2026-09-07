"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import posthog from "posthog-js";
import { toast } from "sonner";
import { api, type RouterOutputs } from "~/trpc/react";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { InventoryFilterOptions } from "~/lib/inventory-filter-options";
import {
  savedSearchDraft,
  serializeSavedSearchDraft,
} from "~/lib/saved-search-draft";
import { savedSearchMatchCriteriaKey } from "~/lib/saved-search-filters";
import { compileSearchExpression } from "~/lib/compile-search-expression";
import { parseAdvancedSearchQuery } from "~/lib/advanced-search-query";
import { useInventoryFilterOptions } from "~/hooks/use-inventory-filter-options";
import { useAlertSubscriptionAccess } from "~/hooks/use-alert-subscription-access";
import { SavedSearchAlerts } from "~/components/search/SavedSearchAlerts";
import { InventoryFilterFeedback } from "~/components/search/InventoryFilterFeedback";
import { DeleteSavedSearchDialog } from "~/components/search/DeleteSavedSearchDialog";
import { Button } from "~/components/ui/button";
import { BuilderEdits } from "./BuilderEdits";
import { FilterSuggestions } from "./FilterSuggestions";
import { NameField, SortField } from "./controls";
import { SearchTerms } from "./QueryView";
import "./editor.css";

type SavedSearch = RouterOutputs["savedSearches"]["list"][number];
export function SavedSearchWorkspace({
  search,
  source,
  locked,
  onClose,
  focusAlerts = false,
}: {
  search: SavedSearch;
  source: "settings" | "saved_searches_list";
  locked: boolean;
  onClose: () => void;
  focusAlerts?: boolean;
}) {
  const utils = api.useUtils();
  const [draft, setDraft] = useState(() => savedSearchDraft(search));
  const [pendingEdits, setPendingEdits] = useState(0);
  const [error, setError] = useState<string>();
  const { canAttemptAlertInteraction, openAlertUpgrade } =
    useAlertSubscriptionAccess(source);
  const { data: notifications, isPending: notificationsPending } =
    api.user.getNotificationSettings.useQuery();
  const remove = api.savedSearches.delete.useMutation({
    onSuccess: () => {
      posthog.capture(AnalyticsEvents.SAVED_SEARCH_DELETED, {
        search_id: search.id,
        source,
      });
      void utils.savedSearches.list.invalidate();
      toast.success("Search deleted");
      onClose();
    },
  });
  const options = useInventoryFilterOptions(true);
  const available = InventoryFilterOptions.withSelected(
    options.data,
    draft.criteria,
  );
  const update = api.savedSearches.update.useMutation({
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
  });
  const busy = update.isPending || remove.isPending;
  const capabilities = api.status.searchCapabilities.useQuery(undefined, {
    staleTime: Infinity,
    retry: false,
  });
  useEffect(() => {
    if (focusAlerts) document.getElementById("search-alerts")?.focus();
  }, [focusAlerts]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        pendingEdits ||
        JSON.stringify(draft) !== JSON.stringify(savedSearchDraft(search))
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft, pendingEdits, search]);
  const submit = () => {
    if (busy || locked) return;
    if (pendingEdits) {
      setError("Apply or cancel the condition you are editing before saving.");
      return;
    }
    if (!draft.name.trim()) {
      setError("Enter a name for this saved search.");
      return;
    }
    const parsed = serializeSavedSearchDraft(draft, search);
    if (!parsed.success) {
      setError(parsed.error);
      return;
    }
    const matchingChanged =
      savedSearchMatchCriteriaKey(parsed.data.query, parsed.data.filters) !==
      savedSearchMatchCriteriaKey(search.query, search.filters);
    const compiled =
      draft.expression === null
        ? null
        : compileSearchExpression(draft.expression);
    const legacy = parseAdvancedSearchQuery(parsed.data.query);
    if (
      matchingChanged &&
      ((compiled?.success && compiled.data.requiresTokens) ||
        (legacy.success && legacy.data.anyWordGroups.length > 0)) &&
      !capabilities.data?.booleanOrSearchReady
    ) {
      setError(
        "Boolean OR search is temporarily unavailable while the search index updates. Your changes are preserved here.",
      );
      return;
    }
    if (
      matchingChanged &&
      parsed.data.filters.vinPattern &&
      !capabilities.data?.vinPatternSearchReady
    ) {
      setError(
        "VIN search is temporarily unavailable while the search index updates. Your changes are preserved here.",
      );
      return;
    }
    update.mutate({
      id: search.id,
      name: draft.name.trim(),
      ...parsed.data,
      ...(draft.email !== search.emailAlertsEnabled
        ? { emailAlertsEnabled: draft.email }
        : {}),
      ...(draft.discord !== search.discordAlertsEnabled
        ? { discordAlertsEnabled: draft.discord }
        : {}),
    });
  };
  return (
    <BuilderEdits
      value={{ pending: pendingEdits, setPending: setPendingEdits }}
    >
      <FilterSuggestions value={available}>
        <form
          className="se-workspace"
          aria-label="Saved search workspace"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <header className="se-workspace-heading">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onClose}
            >
              <ArrowLeft />
              Saved searches
            </Button>
            <h1>Edit saved search</h1>
          </header>
          {locked && (
            <p className="se-hint">
              Upgrade to Lite to edit this search. You can still delete it
              below.
            </p>
          )}
          <fieldset disabled={locked || busy} className="se-workspace-grid">
            <div className="se-workspace-main">
              <NameField
                draft={draft}
                onChange={(next) => {
                  setDraft(next);
                  setError(undefined);
                }}
              />
              <SearchTerms
                draft={draft}
                onChange={(next) => {
                  setDraft(next);
                  setError(undefined);
                }}
              />
              <InventoryFilterFeedback
                isPending={options.isPending}
                isError={options.isError}
                retry={() => void options.refetch()}
              />
            </div>
            <aside className="se-workspace-aside">
              <SortField
                value={draft.criteria}
                onChange={(criteria) => setDraft({ ...draft, criteria })}
              />
              <section
                className="se-alert-section"
                id="search-alerts"
                tabIndex={-1}
                aria-label={`Alerts for ${draft.name}`}
              >
                <h2>Alerts for this search</h2>
                <p className="se-hint">
                  Get notified when new vehicles match this search.
                </p>
                <SavedSearchAlerts
                  searchName={draft.name}
                  emailEnabled={draft.email}
                  discordEnabled={draft.discord}
                  disabled={locked || busy || notificationsPending}
                  onEmailChange={(enabled) => {
                    if (enabled && !canAttemptAlertInteraction) {
                      void openAlertUpgrade();
                      return;
                    }
                    setDraft({ ...draft, email: enabled });
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
                    setDraft({ ...draft, discord: enabled });
                    setError(undefined);
                  }}
                />
                <Link
                  href="/settings/notifications"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="se-text-button underline"
                >
                  Notification setup (new tab)
                </Link>
              </section>
            </aside>
          </fieldset>
          <footer className="se-actions">
            {error && (
              <p role="alert" className="se-error">
                {error}
              </p>
            )}
            <div className="se-action-row">
              <DeleteSavedSearchDialog
                searchName={search.name}
                disabled={busy}
                onDelete={() => remove.mutateAsync({ id: search.id })}
              />
              <div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={onClose}
                >
                  Cancel
                </Button>
                {!locked && (
                  <Button type="submit" disabled={busy}>
                    {update.isPending ? "Saving…" : "Save changes"}
                  </Button>
                )}
              </div>
            </div>
          </footer>
        </form>
      </FilterSuggestions>
    </BuilderEdits>
  );
}

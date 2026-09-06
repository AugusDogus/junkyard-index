"use client";

import { Bookmark, ChevronDown, ExternalLink, Lock, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { InventoryFilterFeedback } from "~/components/search/InventoryFilterFeedback";
import { SearchCriteriaFields } from "~/components/search/SearchCriteriaFields";
import { SearchEditorContent } from "~/components/search/SearchEditorContent";
import { SavedSearchCriteria } from "~/components/search/SavedSearchCriteria";
import { useInventoryFilterOptions } from "~/hooks/use-inventory-filter-options";
import { SearchCriteria } from "~/lib/search-criteria";
import { FieldError } from "~/components/ui/field";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { DiscordIcon } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import posthog from "posthog-js";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { resolveClientPlanFeatureAccess } from "~/lib/client-plan-feature-access";
import type { PlanAccessState } from "~/lib/plan-access";
import { PLANS, type SavedSearchGateFeature } from "~/lib/plans";
import { isIngestionSource } from "~/lib/ingestion-source";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

const PENDING_SAVE_KEY = "pendingSaveSearch";

function isPlanGateData(
  data: unknown,
): data is { planGateFeature?: SavedSearchGateFeature } {
  if (
    typeof data !== "object" ||
    data === null ||
    !("planGateFeature" in data)
  ) {
    return false;
  }
  const feature: unknown = data.planGateFeature;
  return feature === "saved_searches" || feature === "alerts";
}

export interface SaveSearchFilters {
  vinPattern?: string;
  makes?: string[];
  colors?: string[];
  states?: string[];
  salvageYards?: string[];
  sources?: string[];
  minYear?: number;
  maxYear?: number;
  sortBy?: string;
}

interface SaveSearchDialogProps {
  query: string;
  filters: SaveSearchFilters;
  planAccess: PlanAccessState;
  disabled?: boolean;
  isLoggedIn?: boolean;
  autoOpen?: boolean;
  onAutoOpenHandled?: () => void;
  compact?: boolean;
  iconOnly?: boolean;
}

export function storePendingSaveSearch(
  query: string,
  filters: SaveSearchFilters,
) {
  sessionStorage.setItem(PENDING_SAVE_KEY, JSON.stringify({ query, filters }));
}

export function getPendingSaveSearch(): {
  query: string;
  filters: SaveSearchFilters;
} | null {
  const stored = sessionStorage.getItem(PENDING_SAVE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as { query: string; filters: SaveSearchFilters };
  } catch {
    return null;
  }
}

export function clearPendingSaveSearch() {
  sessionStorage.removeItem(PENDING_SAVE_KEY);
}

export function SaveSearchDialog({
  query,
  filters,
  planAccess,
  disabled,
  isLoggedIn,
  autoOpen,
  onAutoOpenHandled,
  compact,
  iconOnly,
}: SaveSearchDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(() => {
    if (autoOpen && isLoggedIn) {
      onAutoOpenHandled?.();
      return true;
    }
    return false;
  });
  const [name, setName] = useState("");
  const [criteria, setCriteria] = useState(() =>
    SearchCriteria.fromSavedSearch(query, {
      ...filters,
      sources: filters.sources?.filter(isIngestionSource),
    }),
  );
  const [editingCriteria, setEditingCriteria] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const suggestions = useInventoryFilterOptions(open && editingCriteria);
  const parsedCriteria = SearchCriteria.toSavedSearch(criteria);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [notificationsExpanded, setNotificationsExpanded] = useState(false);
  const [isNavigatingToAuth, setIsNavigatingToAuth] = useState(false);

  const utils = api.useUtils();

  const canAttemptSaveSearch = resolveClientPlanFeatureAccess({
    access: planAccess,
    feature: "saved_searches",
  });
  const canAttemptAlertInteraction = resolveClientPlanFeatureAccess({
    access: planAccess,
    feature: "alerts",
  });

  const { data: notificationSettings } =
    api.user.getNotificationSettings.useQuery(undefined, {
      enabled: isLoggedIn,
    });
  const hasDiscordSetup =
    notificationSettings?.hasDiscordLinked &&
    notificationSettings?.discordAppInstalled;

  const wantsNotifications =
    notificationsEnabled && (emailEnabled || discordEnabled);
  const canCreateWithSelectedFeatures =
    canAttemptSaveSearch && (!wantsNotifications || canAttemptAlertInteraction);

  const createMutation = api.savedSearches.create.useMutation({
    onMutate: async (newSearch) => {
      if (canCreateWithSelectedFeatures) {
        await utils.savedSearches.list.cancel();
        const previousSearches = utils.savedSearches.list.getData();

        const optimisticSearch = {
          id: `temp-${Date.now()}`,
          userId: "",
          name: newSearch.name,
          query: newSearch.query,
          filters: newSearch.filters,
          emailAlertsEnabled: newSearch.emailAlertsEnabled ?? false,
          discordAlertsEnabled: newSearch.discordAlertsEnabled ?? false,
          searchMatchVersion: 1,
          emailConfigVersion: 1,
          discordConfigVersion: 1,
          emailStartSequence: 0,
          discordStartSequence: 0,
          lastMatchedPublicationSequence: 0,
          lastCheckedAt: null,
          alertQuarantinedAt: null,
          alertQuarantineReason: null,
          processingLock: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        utils.savedSearches.list.setData(undefined, (old) =>
          old ? [...old, optimisticSearch] : [optimisticSearch],
        );

        return { previousSearches };
      }
      return {};
    },
    onError: (error, _variables, context) => {
      if (context?.previousSearches) {
        utils.savedSearches.list.setData(undefined, context.previousSearches);
      }
      if (error.data?.code === "FORBIDDEN") {
        const gateFeature = isPlanGateData(error.data)
          ? error.data.planGateFeature
          : undefined;
        posthog.capture(AnalyticsEvents.SAVED_SEARCH_LIMIT_REACHED, {
          source_page: "search",
          cta_location: "save_search_dialog",
          gate_feature: gateFeature,
        });
        toast.error(error.message, {
          action: {
            label: "Compare plans",
            onClick: () => {
              posthog.capture(AnalyticsEvents.PRICING_CTA_CLICKED, {
                source_page: "search",
                cta_location: "saved_search_limit_to_checkout",
                is_logged_in: true,
              });
              router.push("/pricing");
            },
          },
        });
        return;
      }
      setFormError(
        error.message ||
          "Your search could not be saved. Your edits are preserved. Please try again.",
      );
      if (canCreateWithSelectedFeatures) {
        setOpen(true);
      }
    },
    onSuccess: async (_data, variables) => {
      posthog.capture(AnalyticsEvents.SAVED_SEARCH_CREATED, {
        has_query: variables.query.trim().length > 0,
        email_alerts_enabled: variables.emailAlertsEnabled ?? false,
        discord_alerts_enabled: variables.discordAlertsEnabled ?? false,
        has_sources_filter: (variables.filters.sources?.length ?? 0) > 0,
      });

      toast.success("Search saved");
      setOpen(false);
      resetForm();
    },
    onSettled: () => {
      void utils.savedSearches.list.invalidate();
    },
  });

  const resetForm = () => {
    setName("");
    setNotificationsEnabled(false);
    setEmailEnabled(true);
    setDiscordEnabled(false);
    setNotificationsExpanded(false);
  };

  const handleSave = () => {
    if (!name.trim()) return;

    const enableEmail = notificationsEnabled && emailEnabled;
    const enableDiscord =
      notificationsEnabled && discordEnabled && !!hasDiscordSetup;
    const parsed = SearchCriteria.toSavedSearch(criteria);
    if (!parsed.success) {
      setFormError(parsed.error);
      return;
    }

    createMutation.mutate({
      name: name.trim(),
      ...parsed.data,
      emailAlertsEnabled: enableEmail,
      discordAlertsEnabled: enableDiscord,
    });
  };

  const isSaving = createMutation.isPending;

  const handleButtonClick = () => {
    if (isLoggedIn) {
      posthog.capture(AnalyticsEvents.SAVE_SEARCH_DIALOG_OPENED, { query });
      setOpen(true);
    } else {
      posthog.capture(AnalyticsEvents.SAVED_SEARCH_AUTH_REQUIRED, { query });
      setIsNavigatingToAuth(true);
      storePendingSaveSearch(query, filters);
      const returnUrl = new URL(
        window.location.pathname + window.location.search,
        window.location.origin,
      );
      returnUrl.searchParams.set("saveSearch", "1");
      const returnTo = encodeURIComponent(
        `${returnUrl.pathname}${returnUrl.search}`,
      );
      router.push(`/auth/sign-in?returnTo=${returnTo}`);
    }
  };

  const handleNotificationsToggle = (enabled: boolean) => {
    setNotificationsEnabled(enabled);
    if (enabled) {
      setNotificationsExpanded(true);
    } else {
      setNotificationsExpanded(false);
    }
  };

  const dialogTrigger = (
    <Button
      variant="outline"
      size={compact || iconOnly ? "sm" : "default"}
      className={compact || iconOnly ? "h-8 text-xs" : ""}
      aria-label={iconOnly ? "Save search" : undefined}
      disabled={disabled || isNavigatingToAuth}
      onClick={(e) => {
        if (!isLoggedIn) {
          e.preventDefault();
          handleButtonClick();
        }
      }}
    >
      <Bookmark className={compact || iconOnly ? "h-3.5 w-3.5" : "h-4 w-4"} />
      {!iconOnly && (isNavigatingToAuth ? "Redirecting..." : "Save Search")}
    </Button>
  );

  if (!canAttemptSaveSearch) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{dialogTrigger}</DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Unlock Saved Searches</DialogTitle>
            <DialogDescription>
              Lite lets you reopen saved searches with every filter intact and
              save new searches.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted/40 my-4 flex items-start gap-3 rounded-lg border p-4">
            <Lock className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <div>
              <p className="text-sm font-medium">Your searches stay saved</p>
              <p className="text-muted-foreground mt-1 text-sm text-pretty">
                Nothing is deleted on the Free plan. Upgrade when you want to
                reopen or add saved searches.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button asChild>
              <Link
                href="/pricing"
                onClick={() =>
                  posthog.capture(AnalyticsEvents.PRICING_CTA_CLICKED, {
                    source_page: "search",
                    cta_location: "saved_search_gate",
                    is_logged_in: true,
                  })
                }
              >
                Upgrade to Lite
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        if (isSaving) return;
        if (newOpen) {
          setCriteria(
            SearchCriteria.fromSavedSearch(query, {
              ...filters,
              sources: filters.sources?.filter(isIngestionSource),
            }),
          );
          setEditingCriteria(false);
          setFormError(undefined);
        }
        setOpen(newOpen);
      }}
    >
      <DialogTrigger asChild>{dialogTrigger}</DialogTrigger>
      <SearchEditorContent
        ref={setContent}
        className={editingCriteria ? undefined : "sm:max-w-lg"}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12 text-left sm:px-6">
          <DialogTitle>Save search</DialogTitle>
          <DialogDescription>
            Save this search to revisit it later.
            {!canAttemptAlertInteraction &&
              ` Alerts are included in the Full plan ($${PLANS.full.monthlyPrice}/mo).`}
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-thin-themed min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-6">
          <fieldset disabled={isSaving} className="flex min-w-0 flex-col gap-6">
            {/* Search Name */}
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="e.g., Honda Civic 2018+"
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
              />
            </div>

            <Collapsible
              open={editingCriteria}
              onOpenChange={setEditingCriteria}
            >
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-medium">Search criteria</h3>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline" size="sm">
                    {editingCriteria
                      ? "Done editing criteria"
                      : "Edit criteria"}
                  </Button>
                </CollapsibleTrigger>
              </div>
              {!editingCriteria && (
                <div className="mt-4">
                  {parsedCriteria.success ? (
                    <SavedSearchCriteria {...parsedCriteria.data} />
                  ) : (
                    <FieldError>{parsedCriteria.error}</FieldError>
                  )}
                </div>
              )}
              <CollapsibleContent className="pt-6">
                <SearchCriteriaFields
                  value={criteria}
                  onChange={(next) => {
                    setCriteria(next);
                    setFormError(undefined);
                  }}
                  filterOptions={suggestions.data}
                  portalContainer={content}
                  filterOptionsFeedback={
                    <InventoryFilterFeedback
                      isPending={suggestions.isPending}
                      isError={suggestions.isError}
                      retry={() => void suggestions.refetch()}
                    />
                  }
                />
              </CollapsibleContent>
            </Collapsible>

            {/* Notifications Section */}
            <Collapsible
              open={notificationsExpanded}
              onOpenChange={setNotificationsExpanded}
              className="rounded-lg border"
            >
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <Switch
                    id="notifications"
                    checked={notificationsEnabled}
                    onCheckedChange={handleNotificationsToggle}
                  />
                  <div>
                    <Label
                      htmlFor="notifications"
                      className="cursor-pointer font-medium"
                    >
                      Enable notifications
                      {!canAttemptAlertInteraction && (
                        <span className="text-muted-foreground ml-1.5 text-sm font-normal">
                          (${PLANS.full.monthlyPrice}/mo)
                        </span>
                      )}
                    </Label>
                    <p className="text-muted-foreground text-xs">
                      Get alerts when new vehicles match
                    </p>
                  </div>
                </div>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    disabled={!notificationsEnabled}
                  >
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 transition-transform",
                        notificationsExpanded && "rotate-180",
                      )}
                    />
                    <span className="sr-only">Toggle notification options</span>
                  </Button>
                </CollapsibleTrigger>
              </div>

              <CollapsibleContent>
                <div className="space-y-3 border-t px-4 pt-3 pb-4">
                  {/* Email Option */}
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="email-alerts"
                      checked={emailEnabled}
                      onCheckedChange={(checked) =>
                        setEmailEnabled(checked === true)
                      }
                      disabled={!notificationsEnabled}
                    />
                    <div className="flex items-center gap-2">
                      <Mail
                        className={cn(
                          "h-4 w-4",
                          !notificationsEnabled && "text-muted-foreground",
                        )}
                      />
                      <Label
                        htmlFor="email-alerts"
                        className={cn(
                          "cursor-pointer text-sm",
                          !notificationsEnabled && "text-muted-foreground",
                        )}
                      >
                        Email
                      </Label>
                    </div>
                  </div>

                  {/* Discord Option */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id="discord-alerts"
                        checked={discordEnabled}
                        onCheckedChange={(checked) =>
                          setDiscordEnabled(checked === true)
                        }
                        disabled={!notificationsEnabled || !hasDiscordSetup}
                      />
                      <div className="flex items-center gap-2">
                        <DiscordIcon
                          className={cn(
                            "h-4 w-4",
                            (!notificationsEnabled || !hasDiscordSetup) &&
                              "text-muted-foreground",
                          )}
                        />
                        <Label
                          htmlFor="discord-alerts"
                          className={cn(
                            "cursor-pointer text-sm",
                            (!notificationsEnabled || !hasDiscordSetup) &&
                              "text-muted-foreground",
                          )}
                        >
                          Discord
                        </Label>
                      </div>
                    </div>
                    {!hasDiscordSetup && (
                      <Link
                        href="/settings/notifications"
                        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
                      >
                        Setup
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                  </div>

                  {!hasDiscordSetup && (
                    <p className="text-muted-foreground pl-6 text-xs">
                      Connect Discord in{" "}
                      <Link
                        href="/settings/notifications"
                        className="hover:text-foreground underline"
                      >
                        notification settings
                      </Link>{" "}
                      to enable Discord notifications.
                    </p>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </fieldset>
        </div>
        <div className="shrink-0 border-t px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          {formError && (
            <FieldError role="alert" className="mb-3">
              {formError}
            </FieldError>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!name.trim() || isSaving}>
              {isSaving ? "Saving…" : "Save search"}
            </Button>
          </DialogFooter>
        </div>
      </SearchEditorContent>
    </Dialog>
  );
}

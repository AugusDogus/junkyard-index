"use client";

import { Bookmark, ChevronDown, ExternalLink, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { authClient } from "~/lib/auth-client";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

const PENDING_SAVE_KEY = "pendingSaveSearch";

export interface SaveSearchFilters {
  makes?: string[];
  colors?: string[];
  states?: string[];
  salvageYards?: string[];
  minYear?: number;
  maxYear?: number;
  sortBy?: string;
}

interface SaveSearchDialogProps {
  query: string;
  filters: SaveSearchFilters;
  disabled?: boolean;
  isLoggedIn?: boolean;
  autoOpen?: boolean;
  onAutoOpenHandled?: () => void;
  compact?: boolean;
  iconOnly?: boolean;
}

export function storePendingSaveSearch(query: string, filters: SaveSearchFilters) {
  sessionStorage.setItem(PENDING_SAVE_KEY, JSON.stringify({ query, filters }));
}

export function getPendingSaveSearch(): { query: string; filters: SaveSearchFilters } | null {
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
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [notificationsExpanded, setNotificationsExpanded] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isNavigatingToAuth, setIsNavigatingToAuth] = useState(false);

  const utils = api.useUtils();
  
  const { data: subscriptionData } = api.subscription.getCustomerState.useQuery(
    undefined,
    { enabled: isLoggedIn }
  );
  const hasActiveSubscription = subscriptionData?.hasActiveSubscription ?? false;

  const { data: notificationSettings } = api.user.getNotificationSettings.useQuery(
    undefined,
    { enabled: isLoggedIn }
  );
  const hasDiscordSetup = notificationSettings?.hasDiscordLinked && notificationSettings?.discordAppInstalled;

  // Determine if this save will require checkout
  const wantsNotifications = notificationsEnabled && (emailEnabled || discordEnabled);
  const needsCheckout = wantsNotifications && !hasActiveSubscription;

  const createMutation = api.savedSearches.create.useMutation({
    onMutate: async (newSearch) => {
      // Only do optimistic updates if we're NOT redirecting to checkout
      if (!needsCheckout) {
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
          lastCheckedAt: null,
          lastVehicleIds: null,
          processingLock: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        utils.savedSearches.list.setData(undefined, (old) =>
          old ? [...old, optimisticSearch] : [optimisticSearch]
        );

        setOpen(false);
        resetForm();

        return { previousSearches };
      }
      return {};
    },
    onError: (error, _variables, context) => {
      if (context?.previousSearches) {
        utils.savedSearches.list.setData(undefined, context.previousSearches);
      }
      toast.error(error.message || "Failed to save search");
      setIsRedirecting(false);
      if (!needsCheckout) {
        setOpen(true);
      }
    },
    onSuccess: async (_data, variables) => {
      // If user wanted notifications but doesn't have subscription, redirect to checkout
      if ((variables.emailAlertsEnabled || variables.discordAlertsEnabled) && !hasActiveSubscription) {
        setIsRedirecting(true);
        try {
          await authClient.checkout({ 
            slug: "Email-Notifications",
          });
        } catch (error) {
          console.error("Failed to redirect to checkout:", error);
          toast.error("Failed to open checkout. Please try again from your saved searches.");
          setIsRedirecting(false);
          setOpen(false);
          resetForm();
          toast.success("Search saved! Enable notifications from your saved searches.");
        }
      } else {
        toast.success("Search saved!");
      }
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
    const enableDiscord = notificationsEnabled && discordEnabled && !!hasDiscordSetup;
    
    createMutation.mutate({
      name: name.trim(),
      query,
      filters,
      emailAlertsEnabled: enableEmail,
      discordAlertsEnabled: enableDiscord,
    });
  };

  const isSaving = createMutation.isPending || isRedirecting;

  const handleButtonClick = () => {
    if (isLoggedIn) {
      setOpen(true);
    } else {
      setIsNavigatingToAuth(true);
      storePendingSaveSearch(query, filters);
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search + "&saveSearch=1");
      router.push(`/auth/sign-in?returnTo=${returnTo}`);
    }
  };

  const handleNotificationsToggle = (enabled: boolean) => {
    setNotificationsEnabled(enabled);
    if (enabled) {
      setNotificationsExpanded(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(newOpen) => !isSaving && setOpen(newOpen)}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size={compact || iconOnly ? "sm" : "default"}
          className={compact || iconOnly ? "h-8 text-xs" : ""}
          disabled={disabled || !query || isNavigatingToAuth}
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
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Save Search</DialogTitle>
          <DialogDescription>
            Save this search to quickly access it later.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {/* Search Name */}
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="e.g., Honda Civic 2018+"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
          </div>

          {/* Search Details */}
          <div className="text-muted-foreground text-sm">
            <p>
              <strong>Query:</strong> {query || "(empty)"}
            </p>
            {filters.makes && filters.makes.length > 0 && (
              <p>
                <strong>Makes:</strong> {filters.makes.join(", ")}
              </p>
            )}
            {filters.colors && filters.colors.length > 0 && (
              <p>
                <strong>Colors:</strong> {filters.colors.join(", ")}
              </p>
            )}
            {filters.states && filters.states.length > 0 && (
              <p>
                <strong>States:</strong> {filters.states.join(", ")}
              </p>
            )}
          </div>

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
                  <Label htmlFor="notifications" className="cursor-pointer font-medium">
                    Enable notifications
                    {!hasActiveSubscription && (
                      <span className="text-muted-foreground ml-1.5 font-normal text-sm">
                        ($3/mo)
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
                      notificationsExpanded && "rotate-180"
                    )}
                  />
                  <span className="sr-only">Toggle notification options</span>
                </Button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent>
              <div className="border-t px-4 pb-4 pt-3 space-y-3">
                {/* Email Option */}
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="email-alerts"
                    checked={emailEnabled}
                    onCheckedChange={(checked) => setEmailEnabled(checked === true)}
                    disabled={!notificationsEnabled}
                  />
                  <div className="flex items-center gap-2">
                    <Mail className={cn(
                      "h-4 w-4",
                      !notificationsEnabled && "text-muted-foreground"
                    )} />
                    <Label
                      htmlFor="email-alerts"
                      className={cn(
                        "cursor-pointer text-sm",
                        !notificationsEnabled && "text-muted-foreground"
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
                      onCheckedChange={(checked) => setDiscordEnabled(checked === true)}
                      disabled={!notificationsEnabled || !hasDiscordSetup}
                    />
                    <div className="flex items-center gap-2">
                      <DiscordIcon className={cn(
                        "h-4 w-4",
                        (!notificationsEnabled || !hasDiscordSetup) && "text-muted-foreground"
                      )} />
                      <Label
                        htmlFor="discord-alerts"
                        className={cn(
                          "cursor-pointer text-sm",
                          (!notificationsEnabled || !hasDiscordSetup) && "text-muted-foreground"
                        )}
                      >
                        Discord
                      </Label>
                    </div>
                  </div>
                  {!hasDiscordSetup && (
                    <Link
                      href="/settings"
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      Setup
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>

                {!hasDiscordSetup && (
                  <p className="text-xs text-muted-foreground pl-6">
                    Connect Discord in{" "}
                    <Link href="/settings" className="underline hover:text-foreground">
                      Settings
                    </Link>{" "}
                    to enable Discord notifications.
                  </p>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
        <DialogFooter>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || isSaving}
          >
            {isRedirecting
              ? "Redirecting to checkout..."
              : createMutation.isPending
                ? "Saving..."
                : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

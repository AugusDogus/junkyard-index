"use client";

import { Bookmark } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { authClient } from "~/lib/auth-client";
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
  const [notifyMe, setNotifyMe] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isNavigatingToAuth, setIsNavigatingToAuth] = useState(false);

  const utils = api.useUtils();
  const { data: subscriptionData } = api.subscription.getCustomerState.useQuery(
    undefined,
    { enabled: isLoggedIn }
  );
  const hasActiveSubscription = subscriptionData?.hasActiveSubscription ?? false;

  // Determine if this save will require checkout
  const needsCheckout = notifyMe && !hasActiveSubscription;

  const createMutation = api.savedSearches.create.useMutation({
    onMutate: async (newSearch) => {
      // Only do optimistic updates if we're NOT redirecting to checkout
      // (If we're redirecting, keep dialog open to show progress)
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
          lastCheckedAt: null,
          lastVehicleIds: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        utils.savedSearches.list.setData(undefined, (old) =>
          old ? [...old, optimisticSearch] : [optimisticSearch]
        );

        setOpen(false);
        setName("");
        setNotifyMe(false);

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
      // Reopen dialog on error so user can retry (only if it was closed)
      if (!needsCheckout) {
        setOpen(true);
      }
    },
    onSuccess: async (_data, variables) => {
      // If user wanted notifications but doesn't have subscription, redirect to checkout
      if (variables.emailAlertsEnabled && !hasActiveSubscription) {
        setIsRedirecting(true);
        try {
          await authClient.checkout({ 
            slug: "Email-Notifications",
          });
        } catch (error) {
          console.error("Failed to redirect to checkout:", error);
          toast.error("Failed to open checkout. Please try again from your saved searches.");
          setIsRedirecting(false);
          // Close dialog since search was saved
          setOpen(false);
          setName("");
          setNotifyMe(false);
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

  const handleSave = () => {
    if (!name.trim()) return;
    createMutation.mutate({
      name: name.trim(),
      query,
      filters,
      emailAlertsEnabled: notifyMe,
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
          <div className="flex items-start space-x-3 pt-2">
            <Checkbox
              id="notify"
              checked={notifyMe}
              onCheckedChange={(checked) => setNotifyMe(checked === true)}
            />
            <div className="grid gap-1.5 leading-none">
              <Label
                htmlFor="notify"
                className="cursor-pointer text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Notify me of new results
                {!hasActiveSubscription && (
                  <span className="text-muted-foreground ml-1 font-normal">
                    ($3/mo)
                  </span>
                )}
              </Label>
              <p className="text-muted-foreground text-xs">
                Get daily email alerts when new vehicles match this search.
              </p>
            </div>
          </div>
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

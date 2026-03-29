"use client";

import {
  AlertCircle,
  Bell,
  BellOff,
  CheckCircle,
  CreditCard,
  ExternalLink,
  Link2Off,
  LogIn,
  Mail,
  MapPin,
  Search,
  Trash2,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { DiscordIcon } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { env } from "~/env";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { authClient, signIn, signOut, useSession } from "~/lib/auth-client";
import { normalizeZipCode } from "~/lib/location-preferences";
import posthog from "posthog-js";
import { api } from "~/trpc/react";

const DISCORD_INSTALL_URL = `https://discord.com/oauth2/authorize?client_id=${env.NEXT_PUBLIC_DISCORD_CLIENT_ID}&integration_type=1&scope=applications.commands`;

export function SettingsDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending: isSessionLoading } = useSession();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [hasClickedInstall, setHasClickedInstall] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [locationMode, setLocationMode] = useState<"auto" | "zip">("auto");
  const [locationZipCode, setLocationZipCode] = useState("");

  const utils = api.useUtils();

  const {
    data: notificationSettings,
    isLoading: isSettingsLoading,
    refetch: refetchSettings,
  } = api.user.getNotificationSettings.useQuery(undefined, {
    enabled: !!session?.user,
  });

  const { data: subscriptionData, isLoading: isSubscriptionLoading } =
    api.subscription.getCustomerState.useQuery(undefined, {
      enabled: !!session?.user,
    });

  const { data: savedSearches, isLoading: isSavedSearchesLoading } =
    api.savedSearches.list.useQuery(undefined, {
      enabled: !!session?.user,
    });

  const {
    data: locationPreference,
    error: locationPreferenceError,
    isError: isLocationPreferenceError,
    isLoading: isLocationPreferenceLoading,
    isSuccess: isLocationPreferenceSuccess,
  } = api.user.getLocationPreference.useQuery(undefined, {
    enabled: !!session?.user,
  });

  const disconnectMutation = api.user.disconnectDiscordApp.useMutation({
    onSuccess: () => {
      toast.success("Discord app disconnected");
      void refetchSettings();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to disconnect Discord app");
    },
  });

  const verifyInstallMutation = api.user.verifyDiscordAppInstalled.useMutation({
    onSuccess: () => {
      posthog.capture(AnalyticsEvents.DISCORD_APP_VERIFIED);
      toast.success(
        "Discord notifications enabled! Check your DMs for a confirmation.",
      );
      void refetchSettings();
    },
    onError: (error) => {
      posthog.capture(AnalyticsEvents.DISCORD_APP_VERIFY_FAILED, {
        error: error.message,
      });
      toast.error(error.message || "Failed to verify Discord app installation");
    },
  });

  const deleteMutation = api.savedSearches.delete.useMutation({
    onSuccess: () => {
      toast.success("Search deleted");
      void utils.savedSearches.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete search");
    },
  });

  const toggleEmailAlertsMutation =
    api.savedSearches.toggleEmailAlerts.useMutation({
      onSuccess: (_, variables) => {
        toast.success(
          variables.enabled ? "Email alerts enabled" : "Email alerts disabled",
        );
        void utils.savedSearches.list.invalidate();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to toggle email alerts");
      },
    });

  const toggleDiscordAlertsMutation =
    api.savedSearches.toggleDiscordAlerts.useMutation({
      onSuccess: (_, variables) => {
        toast.success(
          variables.enabled
            ? "Discord alerts enabled"
            : "Discord alerts disabled",
        );
        void utils.savedSearches.list.invalidate();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to toggle Discord alerts");
      },
    });

  const deleteAccountMutation = api.user.deleteAccount.useMutation({
    onSuccess: async () => {
      await signOut();
      router.push("/");
      router.refresh();
    },
  });

  const updateLocationPreferenceMutation =
    api.user.updateLocationPreference.useMutation({
      onSuccess: async (preference) => {
        await utils.user.getLocationPreference.invalidate();
        setLocationMode(preference.mode);
        setLocationZipCode(preference.zipCode ?? "");
        toast.success(
          "Search location saved. You can use this for distance sorting.",
        );
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save search location.");
      },
    });

  const hasActiveSubscription =
    subscriptionData?.hasActiveSubscription ?? false;
  const canUseDiscord =
    notificationSettings?.hasDiscordLinked &&
    notificationSettings?.discordAppInstalled;

  useEffect(() => {
    if (!isLocationPreferenceSuccess) {
      return;
    }

    if (!locationPreference.hasPreference || !locationPreference.mode) {
      setLocationMode("auto");
      setLocationZipCode("");
      return;
    }

    setLocationMode(locationPreference.mode);
    setLocationZipCode(locationPreference.zipCode ?? "");
  }, [isLocationPreferenceSuccess, locationPreference]);

  useEffect(() => {
    const discordInstalled = searchParams.get("discord_installed");
    const discordError = searchParams.get("discord_error");

    if (discordInstalled === "true") {
      toast.success(
        "Discord app installed successfully! You can now receive Discord notifications.",
      );
      router.replace("/settings", { scroll: false });
      void refetchSettings();
    } else if (discordError) {
      toast.error(discordError);
      router.replace("/settings", { scroll: false });
    }
  }, [searchParams, router, refetchSettings]);

  const handleDiscordSignIn = async () => {
    posthog.capture(AnalyticsEvents.DISCORD_SIGN_IN_INITIATED, {
      context: "settings",
    });
    setIsSigningIn(true);
    try {
      await signIn.social({
        provider: "discord",
        callbackURL: "/settings",
      });
    } catch (error) {
      console.error("Discord sign in error:", error);
      setIsSigningIn(false);
    }
  };

  const handleSubscribe = async () => {
    posthog.capture(AnalyticsEvents.CHECKOUT_INITIATED, { source: "settings" });
    try {
      await authClient.checkout({
        slug: "Email-Notifications",
      });
    } catch (error) {
      console.error("Failed to open checkout:", error);
      toast.error("Failed to open checkout. Please try again.");
    }
  };

  const handleManageSubscription = async () => {
    posthog.capture(AnalyticsEvents.SUBSCRIPTION_PORTAL_OPENED, {
      source: "settings",
    });
    try {
      await authClient.customer?.portal();
    } catch (error) {
      console.error("Failed to open customer portal:", error);
      toast.error("Failed to open subscription portal. Please try again.");
    }
  };

  const handleDisconnectDiscordApp = () => {
    posthog.capture(AnalyticsEvents.DISCORD_APP_DISCONNECTED, {
      source: "settings",
    });
    disconnectMutation.mutate();
  };

  const handleToggleEmailAlerts = (searchId: string, currentState: boolean) => {
    if (!currentState && !hasActiveSubscription) {
      void handleSubscribe();
      return;
    }
    posthog.capture(AnalyticsEvents.SAVED_SEARCH_EMAIL_TOGGLED, {
      search_id: searchId,
      enabled: !currentState,
      source: "settings",
    });
    toggleEmailAlertsMutation.mutate({ id: searchId, enabled: !currentState });
  };

  const handleToggleDiscordAlerts = (
    searchId: string,
    currentState: boolean,
  ) => {
    if (!currentState && !hasActiveSubscription) {
      void handleSubscribe();
      return;
    }
    if (!currentState && !canUseDiscord) {
      toast.error("Please complete Discord setup above first");
      return;
    }
    posthog.capture(AnalyticsEvents.SAVED_SEARCH_DISCORD_TOGGLED, {
      search_id: searchId,
      enabled: !currentState,
      source: "settings",
    });
    toggleDiscordAlertsMutation.mutate({
      id: searchId,
      enabled: !currentState,
    });
  };

  const handleDeleteSearch = (searchId: string) => {
    posthog.capture(AnalyticsEvents.SAVED_SEARCH_DELETED, {
      search_id: searchId,
      source: "settings",
    });
    deleteMutation.mutate({ id: searchId });
  };

  const handleDeleteAccount = () => {
    posthog.capture(AnalyticsEvents.ACCOUNT_DELETED, { source: "settings" });
    deleteAccountMutation.mutate();
  };

  const handleSaveLocationPreference = () => {
    if (locationMode === "auto") {
      updateLocationPreferenceMutation.mutate({ mode: "auto" });
      return;
    }

    const normalizedZipCode = normalizeZipCode(locationZipCode);
    if (!normalizedZipCode) {
      toast.error("Enter a valid 5-digit ZIP code.");
      return;
    }

    updateLocationPreferenceMutation.mutate({
      mode: "zip",
      zipCode: normalizedZipCode,
    });
  };

  if (isSessionLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!session?.user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sign In Required</CardTitle>
          <CardDescription>
            Please sign in to manage your notification settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/auth/sign-in?returnTo=/settings">
            <Button>
              <LogIn className="mr-2 h-4 w-4" />
              Sign In
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const isMutating =
    toggleEmailAlertsMutation.isPending ||
    toggleDiscordAlertsMutation.isPending ||
    deleteMutation.isPending;
  const savedLocationMode = isLocationPreferenceSuccess
    ? locationPreference.hasPreference && locationPreference.mode
      ? locationPreference.mode
      : "auto"
    : null;
  const savedLocationZipCode =
    isLocationPreferenceSuccess &&
    locationPreference.hasPreference &&
    locationPreference.mode === "zip"
      ? (locationPreference.zipCode ?? "")
      : "";
  const isLocationDirty = isLocationPreferenceSuccess
    ? locationMode !== savedLocationMode ||
      (locationMode === "zip" &&
        normalizeZipCode(locationZipCode) !==
          normalizeZipCode(savedLocationZipCode))
    : false;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Search Location
          </CardTitle>
          <CardDescription>
            Choose how distance sorting finds your location. Automatic detection
            uses Vercel IP first, then search IP detection, then browser
            geolocation if needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLocationPreferenceLoading ? (
            <Skeleton className="h-28 w-full" />
          ) : isLocationPreferenceError ? (
            <p className="text-destructive text-sm">
              {locationPreferenceError.message ||
                "Could not load your saved search location right now."}
            </p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant={locationMode === "auto" ? "default" : "outline"}
                  className="justify-start"
                  onClick={() => setLocationMode("auto")}
                >
                  Use Automatic Detection
                </Button>
                <Button
                  type="button"
                  variant={locationMode === "zip" ? "default" : "outline"}
                  className="justify-start"
                  onClick={() => setLocationMode("zip")}
                >
                  Use ZIP Code
                </Button>
              </div>

              {locationMode === "zip" && (
                <div className="grid gap-2">
                  <Label htmlFor="settings-location-zip">ZIP Code</Label>
                  <Input
                    id="settings-location-zip"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    maxLength={5}
                    placeholder="90210"
                    value={locationZipCode}
                    onChange={(event) => setLocationZipCode(event.target.value)}
                  />
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <p className="text-muted-foreground text-sm">
                  This preference is used when you sort search results by
                  distance.
                </p>
                <Button
                  type="button"
                  onClick={handleSaveLocationPreference}
                  disabled={
                    !isLocationDirty ||
                    updateLocationPreferenceMutation.isPending
                  }
                >
                  {updateLocationPreferenceMutation.isPending
                    ? "Saving..."
                    : "Save Location"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Subscription
          </CardTitle>
          <CardDescription>
            A subscription is required to receive vehicle alerts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isSubscriptionLoading ? (
            <Skeleton className="h-10 w-48" />
          ) : hasActiveSubscription ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">Active subscription</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleManageSubscription}
              >
                Manage Subscription
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="text-muted-foreground flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                <span>No active subscription</span>
              </div>
              <Button size="sm" onClick={handleSubscribe}>
                Subscribe ($3/mo)
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DiscordIcon className="h-5 w-5" />
            Discord Notifications
          </CardTitle>
          <CardDescription>
            Set up Discord to receive direct message alerts when new vehicles
            match your searches.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isSettingsLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p
                  className={`text-sm ${notificationSettings?.hasDiscordLinked ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}
                >
                  Step 1:{" "}
                  {notificationSettings?.hasDiscordLinked
                    ? "Discord account linked"
                    : "Sign in with Discord to link your account"}
                </p>
                {!notificationSettings?.hasDiscordLinked && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDiscordSignIn}
                    disabled={isSigningIn}
                  >
                    <DiscordIcon className="mr-2 h-4 w-4" />
                    {isSigningIn ? "Connecting..." : "Sign in with Discord"}
                  </Button>
                )}
              </div>

              <div className="flex items-center justify-between">
                <p
                  className={`text-sm ${notificationSettings?.discordAppInstalled ? "text-green-600 dark:text-green-400" : notificationSettings?.hasDiscordLinked ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
                >
                  Step 2:{" "}
                  {notificationSettings?.discordAppInstalled
                    ? "Discord app installed"
                    : "Authorize Junkyard Index to send you DMs"}
                </p>
                {notificationSettings?.hasDiscordLinked &&
                  !notificationSettings?.discordAppInstalled && (
                    <div className="flex items-center gap-2">
                      {!hasClickedInstall ? (
                        <a
                          href={DISCORD_INSTALL_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setHasClickedInstall(true)}
                        >
                          <Button variant="outline" size="sm">
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Authorize
                          </Button>
                        </a>
                      ) : (
                        <>
                          <a
                            href={DISCORD_INSTALL_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Button variant="ghost" size="sm">
                              <ExternalLink className="mr-2 h-4 w-4" />
                              Authorize
                            </Button>
                          </a>
                          <Button
                            size="sm"
                            onClick={() => verifyInstallMutation.mutate()}
                            disabled={verifyInstallMutation.isPending}
                          >
                            {verifyInstallMutation.isPending
                              ? "Verifying..."
                              : "Verify Install"}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
              </div>

              {notificationSettings?.discordAppInstalled && (
                <div className="flex items-center justify-between border-t pt-2">
                  <span className="text-sm font-medium text-green-600 dark:text-green-400">
                    Ready to receive Discord DMs
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={handleDisconnectDiscordApp}
                    disabled={disconnectMutation.isPending}
                  >
                    <Link2Off className="mr-1 h-3 w-3" />
                    Disconnect
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Saved Searches
          </CardTitle>
          <CardDescription>
            Manage notifications for your saved searches. Toggle email or
            Discord alerts for each search.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isSavedSearchesLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : !savedSearches || savedSearches.length === 0 ? (
            <div className="py-6 text-center">
              <Search className="text-muted-foreground mx-auto mb-3 h-10 w-10" />
              <p className="text-muted-foreground mb-3">
                No saved searches yet
              </p>
              <Link href="/search">
                <Button variant="outline" size="sm">
                  Go to Search
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {savedSearches.map((search) => (
                <div
                  key={search.id}
                  className="flex items-center justify-between gap-4 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{search.name}</p>
                    <p className="text-muted-foreground truncate text-sm">
                      {search.query || "All vehicles"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-8 w-8 p-0 ${search.emailAlertsEnabled ? "text-blue-500" : "text-muted-foreground"}`}
                      onClick={() =>
                        handleToggleEmailAlerts(
                          search.id,
                          search.emailAlertsEnabled,
                        )
                      }
                      disabled={isMutating}
                      title={
                        search.emailAlertsEnabled
                          ? "Email alerts on"
                          : "Email alerts off"
                      }
                      aria-label={
                        search.emailAlertsEnabled
                          ? "Turn off email alerts"
                          : hasActiveSubscription
                            ? "Turn on email alerts"
                            : "Subscribe to enable email alerts"
                      }
                    >
                      {search.emailAlertsEnabled ? (
                        <Mail className="h-4 w-4" />
                      ) : (
                        <BellOff className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-8 w-8 p-0 ${search.discordAlertsEnabled ? "text-[#5865F2]" : "text-muted-foreground"}`}
                      onClick={() =>
                        handleToggleDiscordAlerts(
                          search.id,
                          search.discordAlertsEnabled,
                        )
                      }
                      disabled={isMutating}
                      title={
                        search.discordAlertsEnabled
                          ? "Discord alerts on"
                          : "Discord alerts off"
                      }
                      aria-label={
                        search.discordAlertsEnabled
                          ? "Turn off Discord alerts"
                          : !hasActiveSubscription
                            ? "Subscribe to enable Discord alerts"
                            : !canUseDiscord
                              ? "Set up Discord to enable alerts"
                              : "Turn on Discord alerts"
                      }
                    >
                      <DiscordIcon className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive h-8 w-8 p-0"
                      onClick={() => handleDeleteSearch(search.id)}
                      disabled={isMutating}
                      title="Delete search"
                      aria-label={`Delete saved search "${search.name}"`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="pt-2">
                <Link href="/search">
                  <Button variant="outline" size="sm" className="w-full">
                    <Search className="mr-2 h-4 w-4" />
                    Create New Search
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserX className="h-5 w-5" />
            Delete Account
          </CardTitle>
          <CardDescription>
            Permanently delete your account and all associated data, including
            saved searches and email alerts. This action cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Account
          </Button>
        </CardContent>
      </Card>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete your account? This action cannot
              be undone. All your data, including saved searches and email
              alerts, will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={deleteAccountMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={deleteAccountMutation.isPending}
            >
              {deleteAccountMutation.isPending
                ? "Deleting..."
                : "Delete Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

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
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { Footer } from "~/components/Footer";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { DiscordIcon } from "~/components/ui/icons";
import { Skeleton } from "~/components/ui/skeleton";
import { env } from "~/env";
import { authClient, signIn, useSession } from "~/lib/auth-client";
import { api } from "~/trpc/react";

// Discord app installation URL
const DISCORD_INSTALL_URL = `https://discord.com/oauth2/authorize?client_id=${env.NEXT_PUBLIC_DISCORD_CLIENT_ID}&integration_type=1&scope=applications.commands`;

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending: isSessionLoading } = useSession();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [hasClickedInstall, setHasClickedInstall] = useState(false);

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
      toast.success("Discord notifications enabled! Check your DMs for a confirmation.");
      void refetchSettings();
    },
    onError: (error) => {
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

  const toggleEmailAlertsMutation = api.savedSearches.toggleEmailAlerts.useMutation({
    onSuccess: (_, variables) => {
      toast.success(variables.enabled ? "Email alerts enabled" : "Email alerts disabled");
      void utils.savedSearches.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to toggle email alerts");
    },
  });

  const toggleDiscordAlertsMutation = api.savedSearches.toggleDiscordAlerts.useMutation({
    onSuccess: (_, variables) => {
      toast.success(variables.enabled ? "Discord alerts enabled" : "Discord alerts disabled");
      void utils.savedSearches.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to toggle Discord alerts");
    },
  });

  const hasActiveSubscription = subscriptionData?.hasActiveSubscription ?? false;
  const canUseDiscord = notificationSettings?.hasDiscordLinked && notificationSettings?.discordAppInstalled;

  // Handle URL params for success/error states
  useEffect(() => {
    const discordInstalled = searchParams.get("discord_installed");
    const discordError = searchParams.get("discord_error");

    if (discordInstalled === "true") {
      toast.success("Discord app installed successfully! You can now receive Discord notifications.");
      router.replace("/settings", { scroll: false });
      void refetchSettings();
    } else if (discordError) {
      toast.error(discordError);
      router.replace("/settings", { scroll: false });
    }
  }, [searchParams, router, refetchSettings]);

  const handleDiscordSignIn = async () => {
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
    try {
      await authClient.customer?.portal();
    } catch (error) {
      console.error("Failed to open customer portal:", error);
      toast.error("Failed to open subscription portal. Please try again.");
    }
  };

  const handleDisconnectDiscordApp = () => {
    disconnectMutation.mutate();
  };

  const handleToggleEmailAlerts = (searchId: string, currentState: boolean) => {
    if (!currentState && !hasActiveSubscription) {
      void handleSubscribe();
      return;
    }
    toggleEmailAlertsMutation.mutate({ id: searchId, enabled: !currentState });
  };

  const handleToggleDiscordAlerts = (searchId: string, currentState: boolean) => {
    if (!currentState && !hasActiveSubscription) {
      void handleSubscribe();
      return;
    }
    if (!currentState && !canUseDiscord) {
      toast.error("Please complete Discord setup above first");
      return;
    }
    toggleDiscordAlertsMutation.mutate({ id: searchId, enabled: !currentState });
  };

  const handleDeleteSearch = (searchId: string) => {
    deleteMutation.mutate({ id: searchId });
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

  const isMutating = toggleEmailAlertsMutation.isPending || toggleDiscordAlertsMutation.isPending || deleteMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Subscription Status */}
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
              <Button variant="outline" size="sm" onClick={handleManageSubscription}>
                Manage Subscription
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-muted-foreground">
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

      {/* Discord Setup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DiscordIcon className="h-5 w-5" />
            Discord Notifications
          </CardTitle>
          <CardDescription>
            Set up Discord to receive direct message alerts when new vehicles match your searches.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isSettingsLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="space-y-3">
              {/* Step 1: Link Discord account */}
              <div className="flex items-center justify-between">
                <p className={`text-sm ${notificationSettings?.hasDiscordLinked ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                  Step 1: {notificationSettings?.hasDiscordLinked ? "Discord account linked" : "Sign in with Discord to link your account"}
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

              {/* Step 2: Install Discord app */}
              <div className="flex items-center justify-between">
                <p className={`text-sm ${notificationSettings?.discordAppInstalled ? "text-green-600 dark:text-green-400" : notificationSettings?.hasDiscordLinked ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                  Step 2: {notificationSettings?.discordAppInstalled ? "Discord app installed" : "Install the Discord app to receive DMs"}
                </p>
                {notificationSettings?.hasDiscordLinked && !notificationSettings?.discordAppInstalled && (
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
                          Install App
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
                            Install App
                          </Button>
                        </a>
                        <Button
                          size="sm"
                          onClick={() => verifyInstallMutation.mutate()}
                          disabled={verifyInstallMutation.isPending}
                        >
                          {verifyInstallMutation.isPending ? "Verifying..." : "Verify Install"}
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Ready state with disconnect option */}
              {notificationSettings?.discordAppInstalled && (
                <div className="flex items-center justify-between pt-2 border-t">
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

      {/* Saved Searches */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Saved Searches
          </CardTitle>
          <CardDescription>
            Manage notifications for your saved searches. Toggle email or Discord alerts for each search.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isSavedSearchesLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : !savedSearches || savedSearches.length === 0 ? (
            <div className="text-center py-6">
              <Search className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground mb-3">No saved searches yet</p>
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
                    <p className="font-medium truncate">{search.name}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      {search.query || "All vehicles"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Email toggle */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-8 w-8 p-0 ${search.emailAlertsEnabled ? "text-blue-500" : "text-muted-foreground"}`}
                      onClick={() => handleToggleEmailAlerts(search.id, search.emailAlertsEnabled)}
                      disabled={isMutating}
                      title={search.emailAlertsEnabled ? "Email alerts on" : "Email alerts off"}
                      aria-label={search.emailAlertsEnabled ? "Turn off email alerts" : hasActiveSubscription ? "Turn on email alerts" : "Subscribe to enable email alerts"}
                    >
                      {search.emailAlertsEnabled ? <Mail className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                    </Button>
                    {/* Discord toggle */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-8 w-8 p-0 ${search.discordAlertsEnabled ? "text-[#5865F2]" : "text-muted-foreground"}`}
                      onClick={() => handleToggleDiscordAlerts(search.id, search.discordAlertsEnabled)}
                      disabled={isMutating}
                      title={search.discordAlertsEnabled ? "Discord alerts on" : "Discord alerts off"}
                      aria-label={search.discordAlertsEnabled ? "Turn off Discord alerts" : !hasActiveSubscription ? "Subscribe to enable Discord alerts" : !canUseDiscord ? "Set up Discord to enable alerts" : "Turn on Discord alerts"}
                    >
                      <DiscordIcon className="h-4 w-4" />
                    </Button>
                    {/* Delete */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
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
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="bg-background min-h-screen">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
          <Link href="/" className="text-2xl font-bold">
            Junkyard Index
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            Manage your subscription and notification preferences.
          </p>
        </div>

        <Suspense
          fallback={
            <div className="space-y-6">
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          }
        >
          <SettingsContent />
        </Suspense>
      </main>

      <Footer />
    </div>
  );
}

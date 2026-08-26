"use client";

import { ExternalLink, Link2Off } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { DiscordIcon } from "~/components/ui/icons";
import { Skeleton } from "~/components/ui/skeleton";
import { env } from "~/env";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { signIn } from "~/lib/auth-client";
import { api } from "~/trpc/react";

const DISCORD_INSTALL_URL = `https://discord.com/oauth2/authorize?client_id=${env.NEXT_PUBLIC_DISCORD_CLIENT_ID}&integration_type=1&scope=applications.commands`;

export function DiscordSettingsCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [hasClickedInstall, setHasClickedInstall] = useState(false);
  const settings = api.user.getNotificationSettings.useQuery();
  const disconnect = api.user.disconnectDiscordApp.useMutation({
    onSuccess: () => {
      toast.success("Discord app disconnected");
      void settings.refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to disconnect Discord app");
    },
  });
  const verifyInstall = api.user.verifyDiscordAppInstalled.useMutation({
    onSuccess: () => {
      posthog.capture(AnalyticsEvents.DISCORD_APP_VERIFIED);
      toast.success(
        "Discord notifications enabled! Check your DMs for a confirmation.",
      );
      void settings.refetch();
    },
    onError: (error) => {
      posthog.capture(AnalyticsEvents.DISCORD_APP_VERIFY_FAILED, {
        error: error.message,
      });
      toast.error(error.message || "Failed to verify Discord app installation");
    },
  });

  useEffect(() => {
    const discordInstalled = searchParams.get("discord_installed");
    const discordError = searchParams.get("discord_error");
    if (discordInstalled === "true") {
      toast.success(
        "Discord app installed successfully! You can now receive Discord notifications.",
      );
      router.replace("/settings/notifications", { scroll: false });
      void settings.refetch();
    } else if (discordError) {
      toast.error(discordError);
      router.replace("/settings/notifications", { scroll: false });
    }
  }, [router, searchParams, settings.refetch]);

  const connect = async () => {
    posthog.capture(AnalyticsEvents.DISCORD_SIGN_IN_INITIATED, {
      context: "settings",
    });
    setIsSigningIn(true);
    try {
      await signIn.social({
        provider: "discord",
        callbackURL: "/settings/notifications",
      });
    } catch (error) {
      console.error("Discord sign in error:", error);
      setIsSigningIn(false);
    }
  };

  const disconnectApp = () => {
    posthog.capture(AnalyticsEvents.DISCORD_APP_DISCONNECTED, {
      source: "settings",
    });
    disconnect.mutate();
  };

  return (
    <section aria-labelledby="discord-notifications-heading">
      <div className="max-w-2xl">
        <h2
          id="discord-notifications-heading"
          className="text-xl font-semibold"
        >
          Discord
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Receive a direct message when a new vehicle matches a saved search.
          Setup has two steps so Junkyard Index can identify your account and
          deliver messages to it.
        </p>
      </div>

      <div className="mt-6">
        {settings.isLoading ? (
          <div className="border-border space-y-4 border-y py-5">
            <Skeleton className="h-5 w-64 max-w-full" />
            <Skeleton className="h-9 w-40" />
          </div>
        ) : (
          <>
            <ol className="border-border divide-y border-y">
              <li className="grid gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="text-sm font-medium">1. Link your account</p>
                  <p className="text-muted-foreground mt-1 text-sm leading-6">
                    {settings.data?.hasDiscordLinked
                      ? "Your Discord identity is linked."
                      : "Sign in with Discord so alerts reach the correct account."}
                  </p>
                </div>
                {!settings.data?.hasDiscordLinked && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void connect()}
                    disabled={isSigningIn}
                  >
                    <DiscordIcon data-icon="inline-start" />
                    {isSigningIn ? "Connecting..." : "Sign in with Discord"}
                  </Button>
                )}
              </li>

              <li className="grid gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    2. Authorize direct messages
                  </p>
                  <p className="text-muted-foreground mt-1 text-sm leading-6">
                    {settings.data?.discordAppInstalled
                      ? "Junkyard Index is authorized to send you alerts."
                      : settings.data?.hasDiscordLinked
                        ? "Authorize the app, then return here to verify the connection."
                        : "Complete the first step before authorizing the app."}
                  </p>
                </div>
                {settings.data?.hasDiscordLinked &&
                  !settings.data.discordAppInstalled && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button asChild variant="outline" size="sm">
                        <a
                          href={DISCORD_INSTALL_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setHasClickedInstall(true)}
                        >
                          <ExternalLink data-icon="inline-start" />
                          {hasClickedInstall
                            ? "Open authorization"
                            : "Authorize"}
                        </a>
                      </Button>
                      {hasClickedInstall && (
                        <Button
                          size="sm"
                          onClick={() => verifyInstall.mutate()}
                          disabled={verifyInstall.isPending}
                        >
                          {verifyInstall.isPending
                            ? "Verifying..."
                            : "Verify connection"}
                        </Button>
                      )}
                    </div>
                  )}
              </li>
            </ol>

            {settings.data?.discordAppInstalled && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-medium">
                  Discord alerts are ready to use.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={disconnectApp}
                  disabled={disconnect.isPending}
                >
                  <Link2Off data-icon="inline-start" />
                  Disconnect
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

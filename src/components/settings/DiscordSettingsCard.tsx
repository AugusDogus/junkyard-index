"use client";

import { ExternalLink, Link2Off } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
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
      router.replace("/settings", { scroll: false });
      void settings.refetch();
    } else if (discordError) {
      toast.error(discordError);
      router.replace("/settings", { scroll: false });
    }
  }, [router, searchParams, settings.refetch]);

  const connect = async () => {
    posthog.capture(AnalyticsEvents.DISCORD_SIGN_IN_INITIATED, {
      context: "settings",
    });
    setIsSigningIn(true);
    try {
      await signIn.social({ provider: "discord", callbackURL: "/settings" });
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
        {settings.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p
                className={`text-sm ${settings.data?.hasDiscordLinked ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}
              >
                Step 1:{" "}
                {settings.data?.hasDiscordLinked
                  ? "Discord account linked"
                  : "Sign in with Discord to link your account"}
              </p>
              {!settings.data?.hasDiscordLinked && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void connect()}
                  disabled={isSigningIn}
                >
                  <DiscordIcon className="mr-2 h-4 w-4" />
                  {isSigningIn ? "Connecting..." : "Sign in with Discord"}
                </Button>
              )}
            </div>

            <div className="flex items-center justify-between">
              <p
                className={`text-sm ${settings.data?.discordAppInstalled ? "text-green-600 dark:text-green-400" : settings.data?.hasDiscordLinked ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
              >
                Step 2:{" "}
                {settings.data?.discordAppInstalled
                  ? "Discord app installed"
                  : "Authorize Junkyard Index to send you DMs"}
              </p>
              {settings.data?.hasDiscordLinked &&
                !settings.data.discordAppInstalled && (
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
                          onClick={() => verifyInstall.mutate()}
                          disabled={verifyInstall.isPending}
                        >
                          {verifyInstall.isPending
                            ? "Verifying..."
                            : "Verify Install"}
                        </Button>
                      </>
                    )}
                  </div>
                )}
            </div>

            {settings.data?.discordAppInstalled && (
              <div className="flex items-center justify-between border-t pt-2">
                <span className="text-sm font-medium text-green-600 dark:text-green-400">
                  Ready to receive Discord DMs
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={disconnectApp}
                  disabled={disconnect.isPending}
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
  );
}

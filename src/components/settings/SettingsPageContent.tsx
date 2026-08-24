"use client";

import { LogIn } from "lucide-react";
import Link from "next/link";
import { DeleteAccountCard } from "~/components/settings/DeleteAccountCard";
import { DiscordSettingsCard } from "~/components/settings/DiscordSettingsCard";
import { LocationSettingsCard } from "~/components/settings/LocationSettingsCard";
import { SavedSearchSettingsCard } from "~/components/settings/SavedSearchSettingsCard";
import { SubscriptionSettingsCard } from "~/components/settings/SubscriptionSettingsCard";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { useSession } from "~/lib/auth-client";

export function SettingsDashboard() {
  const { data: session, isPending } = useSession();

  if (isPending) {
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

  return (
    <div className="space-y-6">
      <LocationSettingsCard />
      <SubscriptionSettingsCard />
      <DiscordSettingsCard />
      <SavedSearchSettingsCard />
      <DeleteAccountCard />
    </div>
  );
}

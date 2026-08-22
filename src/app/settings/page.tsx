import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PageShell } from "~/components/PageShell";
import { SettingsDashboard } from "~/components/settings/SettingsDashboard";
import { Skeleton } from "~/components/ui/skeleton";
import { auth } from "~/lib/auth";

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/auth/sign-in?returnTo=%2Fsettings");
  }

  return (
    <PageShell width="wide">
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your subscription, notification, and search location
          preferences.
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
        <SettingsDashboard />
      </Suspense>
    </PageShell>
  );
}

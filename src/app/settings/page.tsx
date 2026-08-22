import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";
import { SettingsDashboard } from "~/components/settings/SettingsDashboard";
import { Skeleton } from "~/components/ui/skeleton";
import { auth } from "~/lib/auth";
import { isGuestSession } from "~/lib/session-user";

export default async function SettingsPage() {
  // Guest (anonymous) sessions are invisible in the UI; they have no
  // settings to manage, so send them to sign-in like logged-out visitors.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user || isGuestSession(session.user)) {
    redirect("/auth/sign-in?returnTo=%2Fsettings");
  }

  return (
    <div className="bg-background min-h-screen">
      <Header />

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
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
      </main>

      <Footer />
    </div>
  );
}

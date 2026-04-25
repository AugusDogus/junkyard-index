import { Suspense } from "react";
import { Footer } from "~/components/Footer";
import { StaticHeader } from "~/components/StaticHeader";
import { SettingsDashboardWithProviders } from "~/components/settings/SettingsDashboardWithProviders";
import { Skeleton } from "~/components/ui/skeleton";

export default function SettingsPage() {
  return (
    <div className="bg-background min-h-screen">
      <StaticHeader />

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
          <SettingsDashboardWithProviders />
        </Suspense>
      </main>

      <Footer />
    </div>
  );
}

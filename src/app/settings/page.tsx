import { Suspense } from "react";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";
import { SettingsDashboard } from "~/components/settings/SettingsDashboard";
import { Skeleton } from "~/components/ui/skeleton";

export default function SettingsPage() {
  return (
    <div className="bg-background min-h-screen">
      <Header />

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
          <SettingsDashboard />
        </Suspense>
      </main>

      <Footer />
    </div>
  );
}

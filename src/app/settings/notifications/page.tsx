import type { Metadata } from "next";
import { Suspense } from "react";
import { DiscordSettingsCard } from "~/components/settings/DiscordSettingsCard";
import { SettingsPageHeader } from "~/components/settings/SettingsPageHeader";
import { Skeleton } from "~/components/ui/skeleton";

export const metadata: Metadata = { title: "Notification settings" };

export default function NotificationSettingsPage() {
  return (
    <div className="space-y-14">
      <SettingsPageHeader
        title="Notifications"
        description="Connect delivery channels for alerts from your saved searches."
      />
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <DiscordSettingsCard />
      </Suspense>
    </div>
  );
}

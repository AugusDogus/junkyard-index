import type { Metadata } from "next";
import { SettingsPageHeader } from "~/components/settings/SettingsPageHeader";
import { SubscriptionSettingsCard } from "~/components/settings/SubscriptionSettingsCard";

export const metadata: Metadata = { title: "Plan and billing settings" };

export default function BillingSettingsPage() {
  return (
    <div className="space-y-14">
      <SettingsPageHeader
        title="Plan and billing"
        description="Review your current plan and open the billing portal when you need to make a change."
      />
      <SubscriptionSettingsCard />
    </div>
  );
}

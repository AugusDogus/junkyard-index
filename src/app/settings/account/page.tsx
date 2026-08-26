import type { Metadata } from "next";
import { AccountDetails } from "~/components/settings/AccountDetails";
import { DeleteAccountCard } from "~/components/settings/DeleteAccountCard";
import { SettingsPageHeader } from "~/components/settings/SettingsPageHeader";

export const metadata: Metadata = { title: "Account settings" };

export default function AccountSettingsPage() {
  return (
    <div className="space-y-14">
      <SettingsPageHeader
        title="Account"
        description="Review your identity and control access to your Junkyard Index account."
      />
      <AccountDetails />
      <DeleteAccountCard />
    </div>
  );
}

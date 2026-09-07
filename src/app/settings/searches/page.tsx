import type { Metadata } from "next";
import { LocationSettingsCard } from "~/components/settings/LocationSettingsCard";
import { SavedSearchSettingsCard } from "~/components/settings/SavedSearchSettingsCard";
import { SettingsPageHeader } from "~/components/settings/SettingsPageHeader";

export const metadata: Metadata = { title: "Search settings" };

export default function SearchSettingsPage() {
  return (
    <div className="flex flex-col gap-10 sm:gap-14">
      <SettingsPageHeader
        title="Searches"
        description="Keep track of the vehicles you’re looking for, including those that haven’t arrived yet."
      />
      <SavedSearchSettingsCard />
      <LocationSettingsCard />
    </div>
  );
}

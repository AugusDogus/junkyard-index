import type { Metadata } from "next";
import { LocationSettingsCard } from "~/components/settings/LocationSettingsCard";
import { SavedSearchSettingsCard } from "~/components/settings/SavedSearchSettingsCard";
import { SettingsPageHeader } from "~/components/settings/SettingsPageHeader";

export const metadata: Metadata = { title: "Search settings" };

export default function SearchSettingsPage() {
  return (
    <div className="space-y-14">
      <SettingsPageHeader
        title="Searches"
        description="Manage the searches you return to and the location used for distance sorting."
      />
      <SavedSearchSettingsCard />
      <LocationSettingsCard />
    </div>
  );
}

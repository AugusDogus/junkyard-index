"use client";

import { SettingsDashboard } from "~/components/settings/SettingsDashboard";
import { TRPCReactProvider } from "~/trpc/react";

export function SettingsDashboardWithProviders() {
  return (
    <TRPCReactProvider>
      <SettingsDashboard />
    </TRPCReactProvider>
  );
}

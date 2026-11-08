"use client";

import { NuqsAdapter } from "nuqs/adapters/next/app";
import { createContext, useContext, type ReactNode } from "react";
import { Toaster } from "~/components/ui/sonner";
import { TRPCReactProvider } from "~/trpc/react";

const InsideAppProviders = createContext(false);

/**
 * Client state for the app's interactive routes (search, saved searches,
 * settings, pricing, checkout, yard requests): tRPC with React Query, URL
 * state, and toasts. Public pages render without these, so they don't
 * download or hydrate them.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <InsideAppProviders.Provider value={true}>
      <NuqsAdapter>
        <TRPCReactProvider>
          {children}
          <Toaster />
        </TRPCReactProvider>
      </NuqsAdapter>
    </InsideAppProviders.Provider>
  );
}

/**
 * The app providers for a component that also renders on public pages, such
 * as the signed-in user menu: added only where the page lacks them, so an app
 * route doesn't get a second toaster.
 */
export function EnsureAppProviders({ children }: { children: ReactNode }) {
  return useContext(InsideAppProviders) ? (
    children
  ) : (
    <AppProviders>{children}</AppProviders>
  );
}

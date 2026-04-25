"use client";

import { SearchPageContent } from "~/components/search/SearchPageContent";
import { TRPCReactProvider } from "~/trpc/react";
import { NuqsAdapter } from "nuqs/adapters/next/app";

interface SearchPageWithProvidersProps {
  isLoggedIn?: boolean;
  userLocation?: { lat: number; lng: number };
}

export function SearchPageWithProviders(props: SearchPageWithProvidersProps) {
  return (
    <NuqsAdapter>
      <TRPCReactProvider>
        <SearchPageContent {...props} />
      </TRPCReactProvider>
    </NuqsAdapter>
  );
}

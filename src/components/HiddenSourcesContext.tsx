"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { HiddenSources } from "~/lib/hidden-source";

const HiddenSourcesContext = createContext<HiddenSources | null>(null);

/**
 * The sources hidden from the public site, for client components that list
 * sources or link to their websites. The server reads the list
 * (`getHiddenSources`) and passes it down; the search page takes it from its
 * search key, so a renewed key updates it.
 */
export function HiddenSourcesProvider({
  hidden,
  children,
}: {
  hidden: HiddenSources;
  children: ReactNode;
}) {
  return (
    <HiddenSourcesContext.Provider value={hidden}>
      {children}
    </HiddenSourcesContext.Provider>
  );
}

/**
 * The hidden sources from the nearest provider. Without one there is no
 * safe default (showing every source could link to a hacked site), so a
 * missing provider is a bug that fails loudly.
 */
export function useHiddenSources(): HiddenSources {
  const hidden = useContext(HiddenSourcesContext);
  if (hidden === null) {
    throw new Error(
      "useHiddenSources found no HiddenSourcesProvider above this component, so it cannot tell which sources are hidden. Wrap the page in HiddenSourcesProvider with the list from getHiddenSources().",
    );
  }
  return hidden;
}

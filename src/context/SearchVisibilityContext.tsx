"use client";

import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
  type MutableRefObject,
} from "react";

interface SearchState {
  query: string;
  onChange: (value: string) => void;
  onSearch: () => void;
}

interface SearchVisibilityContextValue {
  searchStateRef: MutableRefObject<SearchState | null>;
}

const SearchVisibilityContext =
  createContext<SearchVisibilityContextValue | null>(null);

export function SearchVisibilityProvider({
  children,
}: {
  children: ReactNode;
}) {
  const searchStateRef = useRef<SearchState | null>(null);

  const value = useMemo(
    () => ({
      searchStateRef,
    }),
    [],
  );

  return (
    <SearchVisibilityContext.Provider value={value}>
      {children}
    </SearchVisibilityContext.Provider>
  );
}

export function useSearchVisibility() {
  const context = useContext(SearchVisibilityContext);
  if (!context) {
    throw new Error(
      "useSearchVisibility must be used within a SearchVisibilityProvider",
    );
  }
  return context;
}

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
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
  searchBarOffscreen: boolean;
  setSearchBarOffscreen: (offscreen: boolean) => void;
  scrollToSearch: () => void;
  registerSearchElement: (el: HTMLElement | null) => void;
}

const SearchVisibilityContext =
  createContext<SearchVisibilityContextValue | null>(null);

export function SearchVisibilityProvider({
  children,
}: {
  children: ReactNode;
}) {
  const searchStateRef = useRef<SearchState | null>(null);
  const searchElementRef = useRef<HTMLElement | null>(null);
  const [searchBarOffscreen, setSearchBarOffscreen] = useState(false);

  const registerSearchElement = useCallback((el: HTMLElement | null) => {
    searchElementRef.current = el;
  }, []);

  const scrollToSearch = useCallback(() => {
    const el = searchElementRef.current;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      requestAnimationFrame(() => {
        const input = el.querySelector<HTMLInputElement>("input#search");
        input?.focus();
      });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const value = useMemo(
    () => ({
      searchStateRef,
      searchBarOffscreen,
      setSearchBarOffscreen,
      scrollToSearch,
      registerSearchElement,
    }),
    [searchBarOffscreen, scrollToSearch, registerSearchElement],
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

export function useSearchVisibilityOptional() {
  return useContext(SearchVisibilityContext);
}

"use client";

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean | null {
  const [matches, setMatches] = useState<boolean | null>(null);

  useEffect(() => {
    const media = window.matchMedia(query);

    // Set initial value
    setMatches(media.matches);

    // Create listener
    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);

    // Add listener
    media.addEventListener("change", listener);

    // Cleanup
    return () => media.removeEventListener("change", listener);
  }, [query]);

  return matches;
}

export function useIsMobile(): boolean | null {
  return useMediaQuery("(max-width: 767px)");
}

// Returns true for screens in the md breakpoint range (768px - 1023px).
// Used to keep the virtualized results grid aligned with its CSS layout.
export function useIsMediumScreen(): boolean | null {
  return useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
}

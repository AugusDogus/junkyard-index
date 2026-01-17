"use client";

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

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

export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

// Returns true for screens in the md breakpoint range (768px - 1023px)
// Used for making morphing bars more compact
export function useIsMediumScreen(): boolean {
  return useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
}

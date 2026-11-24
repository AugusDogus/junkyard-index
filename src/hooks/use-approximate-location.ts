"use client";

import { useEffect, useState } from "react";
import { VisitorLocation } from "~/lib/visitor-location";
import type { YardLocation } from "~/lib/yard-directory";

/**
 * The visitor's city-level location from their IP, or null until it arrives
 * or when there is none. It only orders the yard directory, so a failed
 * request leaves the directory in its default order.
 */
export function useApproximateLocation(): YardLocation | null {
  const [location, setLocation] = useState<YardLocation | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/visitor-location", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => setLocation(VisitorLocation.parse(body)))
      .catch(() => {
        // Aborted on unmount, or offline: the default order stands.
      });
    return () => controller.abort();
  }, []);

  return location;
}

import { z } from "zod";
import { hasFiniteCoordinates } from "./location-preferences";
import type { YardLocation } from "./yard-directory";

const responseSchema = z.object({
  location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
});

/** What /api/visitor-location sends: a city-level location, or none. */
export type VisitorLocationResponse = z.infer<typeof responseSchema>;

/**
 * The visitor's approximate location from their IP, which sorts the yard
 * directory before they share a precise one. Pages served from the CDN
 * can't read request headers, so the browser asks for it after hydration.
 */
export const VisitorLocation = {
  /** Vercel's IP geolocation, or null when it has none in range. */
  fromGeo(geo: { latitude?: string; longitude?: string }): YardLocation | null {
    const coordinates = {
      lat: geo.latitude ? Number(geo.latitude) : null,
      lng: geo.longitude ? Number(geo.longitude) : null,
    };
    return hasFiniteCoordinates(coordinates) ? coordinates : null;
  },

  response(location: YardLocation | null): VisitorLocationResponse {
    return { location };
  },

  /** The location in a response body, or null for none or a malformed body. */
  parse(body: unknown): YardLocation | null {
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success || parsed.data.location === null) return null;
    return hasFiniteCoordinates(parsed.data.location)
      ? parsed.data.location
      : null;
  },
} as const;

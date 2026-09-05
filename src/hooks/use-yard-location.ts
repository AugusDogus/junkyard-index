"use client";

import { useEffect, useState } from "react";
import {
  hasFiniteCoordinates,
  LOCATION_PREFERENCE_STORAGE_KEY,
  parseStoredLocationPreference,
  type StoredLocationPreference,
} from "~/lib/location-preferences";
import type { YardLocation } from "~/lib/yard-directory";
import { api } from "~/trpc/react";

type LocationRequest =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string };

export function useYardLocation(approximateLocation: YardLocation | null) {
  const [localPreference, setLocalPreference] =
    useState<StoredLocationPreference | null>(null);
  const [browserLocation, setBrowserLocation] = useState<YardLocation | null>(
    null,
  );
  const [request, setRequest] = useState<LocationRequest>({ status: "idle" });
  const { data: accountPreference } = api.user.getLocationPreference.useQuery();

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(
        LOCATION_PREFERENCE_STORAGE_KEY,
      );
      if (stored)
        setLocalPreference(parseStoredLocationPreference(JSON.parse(stored)));
    } catch {
      // A missing or unreadable browser preference leaves the other location sources available.
    }
  }, []);

  const preference = accountPreference?.hasPreference
    ? accountPreference
    : localPreference;
  const savedLocation =
    preference?.mode === "zip" &&
    preference.zipCode &&
    hasFiniteCoordinates(preference)
      ? { lat: preference.lat, lng: preference.lng }
      : null;
  const location = browserLocation ?? savedLocation ?? approximateLocation;

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setRequest({
        status: "error",
        message:
          "Location is unavailable in this browser. You can still find a yard by city or state.",
      });
      return;
    }
    setRequest({ status: "loading" });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const coordinates = { lat: coords.latitude, lng: coords.longitude };
        if (hasFiniteCoordinates(coordinates)) {
          setBrowserLocation(coordinates);
          setRequest({ status: "idle" });
        } else {
          setRequest({
            status: "error",
            message:
              "Your location could not be determined. Try again or find a yard by city or state.",
          });
        }
      },
      (error) =>
        setRequest({
          status: "error",
          message:
            error.code === error.PERMISSION_DENIED
              ? "Location access was denied. Allow it in your browser settings, or find a yard by city or state."
              : "Your location could not be determined. Try again or find a yard by city or state.",
        }),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };

  return {
    location,
    requestLocation,
    locating: request.status === "loading",
    locationError: request.status === "error" ? request.message : null,
  };
}

"use client";

import { MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { normalizeZipCode } from "~/lib/location-preferences";
import { api } from "~/trpc/react";

export function LocationSettingsCard() {
  const [mode, setMode] = useState<"auto" | "zip">("auto");
  const [zipCode, setZipCode] = useState("");
  const utils = api.useUtils();
  const preference = api.user.getLocationPreference.useQuery();
  const updatePreference = api.user.updateLocationPreference.useMutation({
    onSuccess: async (savedPreference) => {
      await utils.user.getLocationPreference.invalidate();
      setMode(savedPreference.mode);
      setZipCode(savedPreference.zipCode ?? "");
      toast.success(
        "Search location saved. You can use this for distance sorting.",
      );
    },
    onError: (error) => {
      toast.error(error.message || "Failed to save search location.");
    },
  });

  useEffect(() => {
    if (!preference.isSuccess) return;
    if (!preference.data.hasPreference || !preference.data.mode) {
      setMode("auto");
      setZipCode("");
      return;
    }
    setMode(preference.data.mode);
    setZipCode(preference.data.zipCode ?? "");
  }, [preference.data, preference.isSuccess]);

  const savedMode = preference.isSuccess
    ? preference.data.hasPreference && preference.data.mode
      ? preference.data.mode
      : "auto"
    : null;
  const savedZipCode =
    preference.isSuccess &&
    preference.data.hasPreference &&
    preference.data.mode === "zip"
      ? (preference.data.zipCode ?? "")
      : "";
  const isDirty = preference.isSuccess
    ? mode !== savedMode ||
      (mode === "zip" &&
        normalizeZipCode(zipCode) !== normalizeZipCode(savedZipCode))
    : false;

  const save = () => {
    if (mode === "auto") {
      updatePreference.mutate({ mode: "auto" });
      return;
    }
    const normalizedZipCode = normalizeZipCode(zipCode);
    if (!normalizedZipCode) {
      toast.error("Enter a valid 5-digit ZIP code.");
      return;
    }
    updatePreference.mutate({ mode: "zip", zipCode: normalizedZipCode });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          Search Location
        </CardTitle>
        <CardDescription>
          Choose how distance sorting finds your location. Automatic detection
          uses Vercel IP first, then search IP detection, then browser
          geolocation if needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {preference.isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : preference.isError ? (
          <p className="text-destructive text-sm">
            {preference.error.message ||
              "Could not load your saved search location right now."}
          </p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant={mode === "auto" ? "default" : "outline"}
                className="justify-start"
                onClick={() => setMode("auto")}
              >
                Use Automatic Detection
              </Button>
              <Button
                type="button"
                variant={mode === "zip" ? "default" : "outline"}
                className="justify-start"
                onClick={() => setMode("zip")}
              >
                Use ZIP Code
              </Button>
            </div>

            {mode === "zip" && (
              <div className="grid gap-2">
                <Label htmlFor="settings-location-zip">ZIP Code</Label>
                <Input
                  id="settings-location-zip"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={5}
                  placeholder="90210"
                  value={zipCode}
                  onChange={(event) => setZipCode(event.target.value)}
                />
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <p className="text-muted-foreground text-sm">
                This preference is used when you sort search results by
                distance.
              </p>
              <Button
                type="button"
                onClick={save}
                disabled={!isDirty || updatePreference.isPending}
              >
                {updatePreference.isPending ? "Saving..." : "Save Location"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

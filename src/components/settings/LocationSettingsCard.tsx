"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
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

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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

  const selectMode = (value: string) => {
    if (value === "auto" || value === "zip") {
      setMode(value);
    }
  };

  return (
    <section aria-labelledby="search-location-heading">
      <div className="max-w-2xl">
        <h2 id="search-location-heading" className="text-xl font-semibold">
          Search location
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Choose the location used when results are sorted by distance.
          Automatic detection checks your network location first and asks the
          browser only when needed.
        </p>
      </div>

      {preference.isLoading ? (
        <div className="mt-6 flex max-w-xl flex-col gap-4">
          <Skeleton className="h-9 w-52" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : preference.isError ? (
        <p className="text-destructive mt-6 max-w-xl text-sm">
          {preference.error.message ||
            "Could not load your saved search location right now."}
        </p>
      ) : (
        <form className="mt-6" onSubmit={handleSubmit}>
          <FieldGroup className="md:grid md:grid-cols-[minmax(0,36rem)_1fr_auto] md:items-end">
            <FieldSet>
              <FieldLegend variant="label">Location source</FieldLegend>
              <ToggleGroup
                type="single"
                value={mode}
                onValueChange={selectMode}
                variant="outline"
                aria-label="Location source"
              >
                <ToggleGroupItem value="auto">Automatic</ToggleGroupItem>
                <ToggleGroupItem value="zip">ZIP code</ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription>
                Your saved choice is used on future searches.
              </FieldDescription>

              {mode === "zip" && (
                <Field>
                  <FieldLabel htmlFor="settings-location-zip">
                    ZIP code
                  </FieldLabel>
                  <Input
                    id="settings-location-zip"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    maxLength={5}
                    placeholder="90210"
                    value={zipCode}
                    onChange={(event) => setZipCode(event.target.value)}
                  />
                </Field>
              )}
            </FieldSet>

            <Field
              orientation="horizontal"
              className="justify-end md:col-start-3 md:w-auto md:justify-self-end"
            >
              <Button
                type="submit"
                disabled={!isDirty || updatePreference.isPending}
              >
                {updatePreference.isPending ? "Saving..." : "Save location"}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      )}
    </section>
  );
}

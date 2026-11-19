"use client";

import { memo, useEffect, useRef } from "react";
import { EnsureAppProviders } from "~/components/AppProviders";
import { useYardLocation } from "~/hooks/use-yard-location";
import type { YardLocation } from "~/lib/yard-directory";
import { YardLocationFooter } from "./YardLocationFooter";

type Props = {
  approximateLocation: YardLocation | null;
  onLocation: (location: YardLocation | null) => void;
  requestOnMount: boolean;
};

export default memo(function YardLocationControls(props: Props) {
  return (
    <EnsureAppProviders>
      <LocationContent {...props} />
    </EnsureAppProviders>
  );
});

function LocationContent({
  approximateLocation,
  onLocation,
  requestOnMount,
}: Props) {
  const state = useYardLocation(approximateLocation);
  const lat = state.location?.lat ?? null;
  const lng = state.location?.lng ?? null;
  const requested = useRef(false);

  useEffect(() => {
    onLocation(lat === null || lng === null ? null : { lat, lng });
  }, [lat, lng, onLocation]);

  useEffect(() => {
    if (requestOnMount && !requested.current) {
      requested.current = true;
      state.requestLocation();
    }
  }, [requestOnMount, state.requestLocation]);

  return <YardLocationFooter {...state} />;
}

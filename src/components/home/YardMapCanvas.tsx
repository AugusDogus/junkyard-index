"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import type { HomepageYard } from "~/lib/homepage-inventory";

function hasMapCoordinates(yard: HomepageYard) {
  return (
    Number.isFinite(yard.lat) &&
    Number.isFinite(yard.lng) &&
    Math.abs(yard.lat) <= 90 &&
    Math.abs(yard.lng) <= 180 &&
    (yard.lat !== 0 || yard.lng !== 0)
  );
}

export default function YardMapCanvas({
  yards,
  selected,
  onSelect,
}: {
  yards: HomepageYard[];
  selected: HomepageYard | null;
  onSelect: (yard: HomepageYard) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  const selectedRef = useRef(selected);
  const [tileError, setTileError] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
      zoomControl: false,
      zoomSnap: 0.25,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    });
    mapRef.current = map;
    const points = yards.filter(hasMapCoordinates);
    const bounds = L.latLngBounds(
      points.map((yard) => L.latLng(yard.lat, yard.lng)),
    );
    const fit = () => {
      map.invalidateSize();
      if (bounds.isValid())
        map.fitBounds(bounds, { padding: [35, 35], maxZoom: 7 });
      else map.setView([39, -98], 4);
    };
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    })
      .on("tileerror", () => setTileError(true))
      .addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    const icon = L.divIcon({
      className: "yard-map-pin",
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    for (const yard of points) {
      const label = document.createElement("span");
      label.textContent = yard.name;
      L.marker([yard.lat, yard.lng], { icon, title: yard.name, alt: yard.name })
        .bindTooltip(label)
        .on("click", () => onSelectRef.current(yard))
        .addTo(map);
    }
    fit();
    const observer = new ResizeObserver(() => {
      if (selectedRef.current) map.invalidateSize();
      else fit();
    });
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [yards]);

  useEffect(() => {
    if (selected && hasMapCoordinates(selected)) {
      mapRef.current?.setView([selected.lat, selected.lng], 9, {
        animate: false,
      });
    } else if (selected === null) {
      const points = yards.filter(hasMapCoordinates);
      if (points.length)
        mapRef.current?.fitBounds(
          L.latLngBounds(points.map((yard) => L.latLng(yard.lat, yard.lng))),
          { padding: [35, 35], maxZoom: 7 },
        );
    }
  }, [selected, yards]);

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={containerRef}
        className="yard-map absolute inset-0"
        aria-label="Map of indexed junkyard locations"
      />
      {tileError && (
        <p
          role="status"
          className="bg-card absolute top-3 left-3 z-10 max-w-64 rounded-md border p-3 text-xs"
        >
          Map tiles could not load. You can still browse every yard in the
          location list.
        </p>
      )}
    </div>
  );
}

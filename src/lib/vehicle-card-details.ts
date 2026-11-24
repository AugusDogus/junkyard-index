import type { SearchVehicle } from "./types";

function text(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && !/^(unknown|n\/?a|-)$/i.test(trimmed) ? trimmed : null;
}

function position(
  vehicle: Pick<SearchVehicle, "section" | "row" | "space">,
): string {
  return [
    ["Section", vehicle.section],
    ["Row", vehicle.row],
    ["Space", vehicle.space],
  ]
    .flatMap(([label, value]) => {
      const detail = text(value);
      // Yards without row numbers export row 0; it is not a place to look.
      if (label === "Row" && detail && /^0+$/.test(detail)) return [];
      return detail ? [`${label} ${detail}`] : [];
    })
    .join(" · ");
}

function miles(distance: number | null): string | null {
  if (distance === null || !Number.isFinite(distance) || distance < 0)
    return null;
  if (distance > 0 && distance < 1) return "<1 mi";
  return `${Math.round(distance).toLocaleString("en-US")} mi`;
}

export const VehicleCardDetails = { text, position, miles } as const;

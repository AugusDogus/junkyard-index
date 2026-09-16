import type { APIEmbed } from "discord-api-types/v10";
import type { SearchVehicle } from "./types";
import { VehicleDestination } from "./vehicle-destination";

function markdownLinkTarget(href: string): string {
  // URL serialization handles whitespace while preserving existing escapes.
  // Encode Markdown delimiters separately; encodeURI would double-encode filters.
  return new URL(href).href.replace(
    /[()[\]<>]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function formatVehicleEmbed(vehicle: SearchVehicle): APIEmbed {
  const destination = VehicleDestination.resolve(vehicle);
  const fields: APIEmbed["fields"] = [
    { name: "Location", value: vehicle.locationName, inline: true },
    {
      name: "Area",
      value: `${vehicle.locationCity}, ${vehicle.stateAbbr}`,
      inline: true,
    },
  ];

  if (vehicle.row) {
    fields.push({
      name: "Row",
      value: vehicle.row + (vehicle.space ? `, Space ${vehicle.space}` : ""),
      inline: true,
    });
  }

  if (vehicle.color) {
    fields.push({ name: "Color", value: vehicle.color, inline: true });
  }

  if (destination.kind !== "inventory" && vehicle.vin.trim()) {
    fields.push({ name: "VIN", value: vehicle.vin, inline: false });
  }

  return {
    title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    // Only vehicle/filtered destinations belong on the vehicle title.
    ...(destination.kind === "inventory" ? { url: destination.href } : {}),
    description:
      destination.kind === "unavailable"
        ? destination.explanation
        : `[${destination.label}](${markdownLinkTarget(destination.href)})${
            destination.kind === "manual-search"
              ? `\n${destination.explanation}`
              : ""
          }`,
    color: 0x5865f2,
    fields,
    thumbnail: vehicle.imageUrl ? { url: vehicle.imageUrl } : undefined,
  };
}

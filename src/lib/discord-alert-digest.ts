import type { APIEmbed } from "discord-api-types/v10";
import type { SearchAlertData, SearchAlertDigest } from "./search-alert-data";
import { formatVehicleEmbed } from "./discord-vehicle-embed";
import type { SearchVehicle } from "./types";

const DISCORD_MESSAGE_EMBED_LIMIT = 10;
const DISCORD_DIGEST_VEHICLE_SLOTS = DISCORD_MESSAGE_EMBED_LIMIT - 1;
const DISCORD_SEARCH_NAME_LINE_LIMIT = 64;

function vehicleNoun(count: number): string {
  return count === 1 ? "vehicle" : "vehicles";
}

function remainingVehiclesText(count: number): string {
  return `...and ${count} more ${vehicleNoun(count)}`;
}

function truncateSearchName(name: string): string {
  return name.length <= DISCORD_SEARCH_NAME_LINE_LIMIT
    ? name
    : `${name.slice(0, DISCORD_SEARCH_NAME_LINE_LIMIT - 3)}...`;
}

function selectPreviewVehicles(
  digest: SearchAlertDigest,
): Array<{ vehicle: SearchVehicle; searchName: string }> {
  const vehiclesPerSearch = Math.max(
    1,
    Math.floor(DISCORD_DIGEST_VEHICLE_SLOTS / digest.previewAlerts.length),
  );
  return digest.previewAlerts
    .flatMap((alert) =>
      alert.match.previewVehicles
        .slice(0, vehiclesPerSearch)
        .map((vehicle) => ({ vehicle, searchName: alert.searchName })),
    )
    .slice(0, DISCORD_DIGEST_VEHICLE_SLOTS);
}

function formatSearchLine(alert: SearchAlertData): string {
  return `${truncateSearchName(alert.searchName)} — ${alert.match.count} new ${vehicleNoun(alert.match.count)}`;
}

function singleSearchHeader(
  alert: SearchAlertData,
  remainingVehicles: number,
): APIEmbed {
  return {
    title: `New Vehicles Found: ${alert.searchName}`.slice(0, 256),
    description: `Found **${alert.match.count}** new ${vehicleNoun(alert.match.count)} matching your saved search.`,
    url: alert.searchUrl,
    color: 0x57f287,
    ...(remainingVehicles > 0
      ? { footer: { text: remainingVehiclesText(remainingVehicles) } }
      : {}),
  };
}

function multiSearchHeader(
  digest: SearchAlertDigest,
  manageSearchesUrl: string,
  remainingVehicles: number,
): APIEmbed {
  const omittedSearches = digest.alertCount - digest.previewAlerts.length;
  const footerParts = [
    remainingVehicles > 0 ? remainingVehiclesText(remainingVehicles) : "",
    omittedSearches > 0
      ? `${omittedSearches} more saved searches. View all saved searches for the full list.`
      : "",
  ].filter(Boolean);

  return {
    title: "Daily saved search update",
    description: [
      `Found **${digest.vehicleCount}** new vehicle matches across **${digest.alertCount}** saved searches.`,
      "",
      ...digest.previewAlerts.map(formatSearchLine),
    ].join("\n"),
    url: manageSearchesUrl,
    color: 0x57f287,
    ...(footerParts.length > 0 ? { footer: { text: footerParts.join(" ") } } : {}),
  };
}

export function formatDiscordDigest(
  digest: SearchAlertDigest,
  manageSearchesUrl: string,
): APIEmbed[] {
  const vehicles = selectPreviewVehicles(digest);
  const first = digest.previewAlerts[0];
  const remainingVehicles = digest.vehicleCount - vehicles.length;
  const header =
    digest.alertCount === 1 && first
      ? singleSearchHeader(first, remainingVehicles)
      : multiSearchHeader(digest, manageSearchesUrl, remainingVehicles);

  return [
    header,
    ...vehicles.map(({ vehicle, searchName }) => {
      const embed = formatVehicleEmbed(vehicle);
      return digest.alertCount === 1
        ? embed
        : {
            ...embed,
            footer: { text: `From ${searchName}`.slice(0, 2048) },
          };
    }),
  ];
}

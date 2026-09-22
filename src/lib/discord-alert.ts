import type { APIEmbed } from "discord-api-types/v10";
import type { SearchAlertData } from "./search-alert-data";
import { formatVehicleEmbed } from "./discord-vehicle-embed";

const DISCORD_MESSAGE_EMBED_LIMIT = 10;
const DISCORD_ALERT_VEHICLE_SLOTS = DISCORD_MESSAGE_EMBED_LIMIT - 1;

export function formatDiscordAlert(data: SearchAlertData): APIEmbed[] {
  // Limit to first 9 vehicles (Discord allows max 10 embeds, and we need 1 for the main embed)
  const vehiclesToShow = data.match.previewVehicles.slice(
    0,
    DISCORD_ALERT_VEHICLE_SLOTS,
  );
  const remainingCount = data.match.count - vehiclesToShow.length;

  const mainEmbed: APIEmbed = {
    title: `New Vehicles Found: ${data.searchName}`,
    description: `Found **${data.match.count}** new vehicle${data.match.count === 1 ? "" : "s"} matching your search${data.query ? ` for "${data.query}"` : ""}.`,
    url: data.searchUrl,
    color: 0x57f287,
    footer:
      remainingCount > 0
        ? {
            text: `...and ${remainingCount} more vehicle${remainingCount === 1 ? "" : "s"}`,
          }
        : undefined,
  };

  return [mainEmbed, ...vehiclesToShow.map(formatVehicleEmbed)];
}

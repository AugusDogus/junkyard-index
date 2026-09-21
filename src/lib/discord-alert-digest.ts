import type { APIEmbed } from "discord-api-types/v10";
import type { SearchAlertDigest } from "./search-alert-data";
import { formatVehicleEmbed } from "./discord-vehicle-embed";

export function formatDiscordDigest(
  digest: SearchAlertDigest,
  manageSearchesUrl: string,
): APIEmbed[] {
  const first = digest.previewAlerts[0];
  if (digest.alertCount === 1 && first) {
    const vehicles = first.match.previewVehicles.slice(0, 9);
    const remaining = first.match.count - vehicles.length;
    return [
      {
        title: `New Vehicles Found: ${first.searchName}`.slice(0, 256),
        description: `Found **${first.match.count}** new vehicle${first.match.count === 1 ? "" : "s"} matching your saved search.`,
        url: first.searchUrl,
        color: 0x57f287,
        ...(remaining > 0
          ? { footer: { text: `...and ${remaining} more vehicles` } }
          : {}),
      },
      ...vehicles.map(formatVehicleEmbed),
    ];
  }

  const previews = digest.previewAlerts.slice(0, 9);
  const omitted = digest.alertCount - previews.length;
  return [
    {
      title: "Daily saved search update",
      description: `Found **${digest.vehicleCount}** new vehicle matches across **${digest.alertCount}** saved searches.`,
      url: manageSearchesUrl,
      color: 0x57f287,
      ...(omitted > 0
        ? {
            footer: {
              text: `${omitted} more saved searches. View all saved searches for the full list.`,
            },
          }
        : {}),
    },
    ...previews.map(
      (alert): APIEmbed => ({
        title: alert.searchName.slice(0, 256),
        description: `**${alert.match.count}** new vehicle${alert.match.count === 1 ? "" : "s"}. Open this search to view matches.`,
        url: alert.searchUrl,
        color: 0x5865f2,
      }),
    ),
  ];
}

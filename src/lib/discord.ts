import { REST } from "@discordjs/rest";
import * as Sentry from "@sentry/nextjs";
import {
  Routes,
  type APIChannel,
  type APIEmbed,
  type APIMessage,
} from "discord-api-types/v10";
import { env } from "~/env";
import type { NotificationDeliveryResult } from "~/lib/notification-delivery-result";
import type { SearchAlertData } from "~/lib/search-alert-data";
import type { SearchVehicle } from "~/lib/types";
import { createDiscordNonce } from "./discord-idempotency";

// Initialize Discord REST client
const discord = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);

interface DiscordMessage {
  content?: string;
  embeds?: APIEmbed[];
  nonce?: string;
  enforce_nonce?: boolean;
}

/**
 * Create a DM channel with a user.
 * Returns the channel ID for sending messages.
 */
export async function createDMChannel(userId: string): Promise<string> {
  const channel = (await discord.post(Routes.userChannels(), {
    body: { recipient_id: userId },
  })) as APIChannel;

  return channel.id;
}

/**
 * Send a message to a Discord channel (including DM channels).
 */
export async function sendMessage(
  channelId: string,
  message: DiscordMessage,
): Promise<APIMessage> {
  return (await discord.post(Routes.channelMessages(channelId), {
    body: message,
  })) as APIMessage;
}

/**
 * Send a DM to a user by their Discord user ID.
 * Creates the DM channel if needed, then sends the message.
 */
export async function sendDM(
  userId: string,
  message: DiscordMessage,
): Promise<NotificationDeliveryResult> {
  try {
    const channelId = await createDMChannel(userId);
    await sendMessage(channelId, message);
    return { success: true };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`Failed to send Discord DM to ${userId}:`, errorMessage);
    Sentry.captureException(error, {
      tags: { context: "discord-dm", userId },
    });
    return { success: false, error: errorMessage };
  }
}

/**
 * Send a test DM to verify the user has installed the app.
 * Returns success if the DM was sent, or an error if not.
 */
export async function sendTestDM(
  userId: string,
  isPaidTier: boolean,
): Promise<NotificationDeliveryResult> {
  const description = isPaidTier
    ? "You've successfully connected Discord to Junkyard Index. You'll receive DMs here when new vehicles match your saved searches with Discord alerts enabled."
    : "You've successfully connected Discord to Junkyard Index. Once you're on the Full plan and enable Discord alerts on a saved search, you'll receive DMs here when new vehicles are found.";

  // Build settings URL from environment
  const baseUrl = env.NEXT_PUBLIC_APP_URL || "https://junkyardindex.com";
  const settingsUrl = `${baseUrl}/settings`;

  const message: DiscordMessage = {
    embeds: [
      {
        title: "Discord Connected",
        description,
        color: 0x57f287, // Green
        footer: { text: `Manage your notifications at ${settingsUrl}` },
      },
    ],
  };

  return sendDM(userId, message);
}

/**
 * Format vehicles into Discord embeds for the alert notification.
 */
function formatVehicleEmbed(vehicle: SearchVehicle): APIEmbed {
  const fields: APIEmbed["fields"] = [
    {
      name: "Location",
      value: vehicle.locationName,
      inline: true,
    },
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
    fields.push({
      name: "Color",
      value: vehicle.color,
      inline: true,
    });
  }

  return {
    title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    url: vehicle.detailsUrl,
    color: 0x5865f2, // Discord blurple
    fields,
    thumbnail: vehicle.imageUrl ? { url: vehicle.imageUrl } : undefined,
  };
}

/**
 * Send a Discord DM alert for new vehicles matching a saved search.
 */
export async function sendDiscordAlert(
  discordUserId: string,
  data: SearchAlertData,
  options?: { idempotencyKey?: string },
): Promise<NotificationDeliveryResult> {
  // Limit to first 9 vehicles (Discord allows max 10 embeds, and we need 1 for the main embed)
  const vehiclesToShow = data.match.previewVehicles.slice(0, 9);
  const remainingCount = data.match.count - vehiclesToShow.length;

  // Create the main message embed
  const mainEmbed: APIEmbed = {
    title: `New Vehicles Found: ${data.searchName}`,
    description: `Found **${data.match.count}** new vehicle${data.match.count === 1 ? "" : "s"} matching your search${data.query ? ` for "${data.query}"` : ""}.`,
    url: data.searchUrl,
    color: 0x57f287, // Green
    footer:
      remainingCount > 0
        ? {
            text: `...and ${remainingCount} more vehicle${remainingCount === 1 ? "" : "s"}`,
          }
        : undefined,
  };

  // Create embeds for each vehicle
  const vehicleEmbeds = vehiclesToShow.map(formatVehicleEmbed);

  // Discord allows max 10 embeds per message (1 main + 9 vehicles = 10 max)
  const message: DiscordMessage = {
    embeds: [mainEmbed, ...vehicleEmbeds],
    ...(options?.idempotencyKey
      ? {
          nonce: createDiscordNonce(options.idempotencyKey),
          enforce_nonce: true,
        }
      : {}),
  };

  return sendDM(discordUserId, message);
}

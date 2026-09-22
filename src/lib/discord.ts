import { REST } from "@discordjs/rest";
import * as Sentry from "@sentry/nextjs";
import {
  Routes,
  type APIChannel,
  type APIEmbed,
  type APIMessage,
} from "discord-api-types/v10";
import { env } from "~/env";
import type {
  NotificationBatchDeliveryResult,
  NotificationDeliveryResult,
} from "~/lib/notification-delivery-result";
import type { SearchAlertData } from "~/lib/search-alert-data";
import { formatDiscordAlert } from "./discord-alert";
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
  const settingsUrl = `${baseUrl}/settings/notifications`;

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
 * Send a Discord DM alert for new vehicles matching a saved search.
 */
export async function sendDiscordAlert(
  discordUserId: string,
  data: SearchAlertData,
  options?: { idempotencyKey?: string },
): Promise<NotificationDeliveryResult> {
  return sendDM(discordUserId, {
    embeds: formatDiscordAlert(data),
    ...(options?.idempotencyKey
      ? {
          nonce: createDiscordNonce(options.idempotencyKey),
          enforce_nonce: true,
        }
      : {}),
  });
}

/** Send one restored per-search preview DM for every alert in the daily claim. */
export async function sendDiscordAlerts(
  discordUserId: string,
  alerts: readonly SearchAlertData[],
  options: { idempotencyKey: string },
): Promise<NotificationBatchDeliveryResult> {
  const sentSearchIds: string[] = [];
  let error: string | undefined;
  for (const alert of alerts) {
    const result = await sendDiscordAlert(discordUserId, alert, {
      idempotencyKey: `${options.idempotencyKey}:${alert.searchId}`,
    });
    if (result.success) {
      sentSearchIds.push(alert.searchId);
      continue;
    }
    error ??= result.error;
  }
  return error === undefined
    ? { success: true, sentSearchIds }
    : { success: false, error, sentSearchIds };
}

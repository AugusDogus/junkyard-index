import {
  MAX_SEARCH_ALERT_DIGEST_PREVIEWS,
  SearchAlertDigest,
  type SearchAlertData,
} from "~/lib/search-alert-data";
import type { NotificationDeliveryResult } from "~/lib/notification-delivery-result";
import {
  SearchAlertResult,
  type AlertChannelResult,
} from "./search-alert-result";

const DELIVERY_FINALIZATION_BATCH_SIZE = 5;

export interface PreparedSearchNotification {
  emailAlertsEnabled: boolean;
  discordAlertsEnabled: boolean;
  queryTime: Date;
  canAdvanceLastCheckedAt: boolean;
  alertData: SearchAlertData;
}

export interface UserNotificationTarget {
  userId: string;
  email: string;
  discordId: string | null;
  discordAppInstalled: boolean;
}

interface StagedNotification {
  searchId: string;
  queryTime: Date;
  canAdvanceLastCheckedAt: boolean;
  newVehicleCount: number;
  discord: AlertChannelResult;
}

export interface NotificationDeliveryDependencies {
  sendEmailDigest: (
    recipient: { userId: string; email: string },
    digest: SearchAlertDigest,
  ) => Promise<NotificationDeliveryResult>;
  sendDiscordAlert: (
    discordUserId: string,
    alert: SearchAlertData,
  ) => Promise<NotificationDeliveryResult>;
  advanceLastCheckedAt: (searchId: string, checkedAt: Date) => Promise<void>;
  captureNotification: (properties: {
    userId: string;
    searchId: string;
    newVehicleCount: number;
    emailSent: boolean;
    discordSent: boolean;
  }) => void;
  runSearchTask: <T>(task: () => Promise<T>) => Promise<T>;
}

export interface SearchNotificationDeliverySession {
  acceptBatch(
    notifications: readonly PreparedSearchNotification[],
  ): Promise<SearchAlertResult[]>;
  finish(): Promise<SearchAlertResult[]>;
}

async function sendDiscordNotification(
  target: UserNotificationTarget,
  notification: PreparedSearchNotification,
  dependencies: NotificationDeliveryDependencies,
): Promise<StagedNotification> {
  let discord: AlertChannelResult = { kind: "not_enabled" };

  if (notification.discordAlertsEnabled) {
    if (!target.discordId) {
      discord = {
        kind: "failed",
        error: "Discord alerts enabled but user has no Discord ID linked",
      };
    } else if (!target.discordAppInstalled) {
      discord = {
        kind: "failed",
        error:
          "Discord alerts enabled but user has not installed the Discord app",
      };
    } else {
      const discordResult = await dependencies.sendDiscordAlert(
        target.discordId,
        notification.alertData,
      );
      discord = discordResult.success
        ? { kind: "sent" }
        : {
            kind: "failed",
            error: `Discord failed: ${discordResult.error}`,
          };
    }
  }

  return {
    searchId: notification.alertData.searchId,
    queryTime: notification.queryTime,
    canAdvanceLastCheckedAt: notification.canAdvanceLastCheckedAt,
    newVehicleCount: notification.alertData.match.count,
    discord,
  };
}

async function finalizeNotification(
  target: UserNotificationTarget,
  notification: StagedNotification,
  email: AlertChannelResult,
  dependencies: NotificationDeliveryDependencies,
): Promise<SearchAlertResult> {
  const result = SearchAlertResult.notification({
    searchId: notification.searchId,
    newVehicleCount: notification.newVehicleCount,
    email,
    discord: notification.discord,
    canAdvanceLastCheckedAt: notification.canAdvanceLastCheckedAt,
  });
  let finalizedResult: SearchAlertResult = result;
  if (result.checkpoint === "advanced") {
    try {
      await dependencies.advanceLastCheckedAt(
        notification.searchId,
        notification.queryTime,
      );
    } catch (error) {
      finalizedResult = SearchAlertResult.checkpointPersistenceFailed(
        result,
        error instanceof Error
          ? error.message
          : "Unknown checkpoint persistence error",
      );
    }
  }

  if (email.kind === "sent" || notification.discord.kind === "sent") {
    dependencies.captureNotification({
      userId: target.userId,
      searchId: notification.searchId,
      newVehicleCount: notification.newVehicleCount,
      emailSent: email.kind === "sent",
      discordSent: notification.discord.kind === "sent",
    });
  }

  return finalizedResult;
}

export function createSearchNotificationDeliverySession(
  target: UserNotificationTarget,
  dependencies: NotificationDeliveryDependencies,
): SearchNotificationDeliverySession {
  const pendingEmailNotifications: StagedNotification[] = [];
  const digestPreviewAlerts: SearchAlertData[] = [];
  let digestAlertCount = 0;
  let digestVehicleCount = 0;
  let state: "accepting" | "finished" = "accepting";

  return {
    async acceptBatch(
      notifications: readonly PreparedSearchNotification[],
    ): Promise<SearchAlertResult[]> {
      if (state !== "accepting") {
        throw new Error("Cannot add notifications after delivery is finished");
      }
      const finalizedResults: SearchAlertResult[] = [];
      const deliveries = await Promise.all(
        notifications.map(async (notification) => ({
          notification,
          staged: await dependencies.runSearchTask(() =>
            sendDiscordNotification(target, notification, dependencies),
          ),
        })),
      );

      for (const { notification, staged } of deliveries) {
        if (notification.emailAlertsEnabled) {
          digestAlertCount += 1;
          digestVehicleCount += notification.alertData.match.count;
          if (digestPreviewAlerts.length < MAX_SEARCH_ALERT_DIGEST_PREVIEWS) {
            digestPreviewAlerts.push(notification.alertData);
          }
          pendingEmailNotifications.push(staged);
        } else {
          finalizedResults.push(
            await finalizeNotification(
              target,
              staged,
              { kind: "not_enabled" },
              dependencies,
            ),
          );
        }
      }
      return finalizedResults;
    },

    async finish(): Promise<SearchAlertResult[]> {
      if (state !== "accepting") {
        throw new Error("Notification delivery is already finished");
      }
      state = "finished";
      const results: SearchAlertResult[] = [];
      const email: AlertChannelResult =
        digestAlertCount === 0
          ? { kind: "not_enabled" }
          : await dependencies
              .sendEmailDigest(
                { userId: target.userId, email: target.email },
                SearchAlertDigest.create(
                  digestPreviewAlerts,
                  digestAlertCount,
                  digestVehicleCount,
                ),
              )
              .then(
                (result): AlertChannelResult =>
                  result.success
                    ? { kind: "sent" }
                    : {
                        kind: "failed",
                        error: `Email failed: ${result.error}`,
                      },
              );

      for (
        let i = 0;
        i < pendingEmailNotifications.length;
        i += DELIVERY_FINALIZATION_BATCH_SIZE
      ) {
        const finalizedBatch = await Promise.all(
          pendingEmailNotifications
            .slice(i, i + DELIVERY_FINALIZATION_BATCH_SIZE)
            .map((notification) =>
              dependencies.runSearchTask(() =>
                finalizeNotification(target, notification, email, dependencies),
              ),
            ),
        );
        results.push(...finalizedBatch);
      }

      return results;
    },
  };
}

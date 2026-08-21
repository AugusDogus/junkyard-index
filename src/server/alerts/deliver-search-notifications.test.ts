import { describe, expect, test } from "bun:test";
import {
  MAX_SEARCH_ALERT_DIGEST_PREVIEWS,
  SearchAlertMatch,
  type SearchAlertData,
  type SearchAlertDigest,
} from "~/lib/search-alert-data";
import {
  createSearchNotificationDeliverySession,
  type NotificationDeliveryDependencies,
  type PreparedSearchNotification,
  type UserNotificationTarget,
} from "./deliver-search-notifications";

function makeNotification(
  searchId: string,
  overrides: Partial<
    Pick<
      PreparedSearchNotification,
      "emailAlertsEnabled" | "discordAlertsEnabled"
    >
  > = {},
): PreparedSearchNotification {
  return {
    emailAlertsEnabled: true,
    discordAlertsEnabled: true,
    ...overrides,
    queryTime: new Date("2026-08-21T07:00:00.000Z"),
    canAdvanceLastCheckedAt: true,
    alertData: {
      searchId,
      searchName: `Search ${searchId}`,
      query: "volvo",
      match: SearchAlertMatch.create(2, []),
      searchUrl: `https://example.com/search/${searchId}`,
    },
  };
}

async function* notificationBatches(
  notifications: PreparedSearchNotification[],
): AsyncGenerator<readonly PreparedSearchNotification[]> {
  yield notifications;
}

async function deliverNotificationBatches(
  target: UserNotificationTarget,
  batches: AsyncIterable<readonly PreparedSearchNotification[]>,
  dependencies: NotificationDeliveryDependencies,
) {
  const delivery = createSearchNotificationDeliverySession(
    target,
    dependencies,
  );
  for await (const notifications of batches) {
    await delivery.acceptBatch(notifications);
  }
  return delivery.finish();
}

describe("deliverSearchNotifications", () => {
  test("sends one email digest and one Discord alert per search", async () => {
    const emailCalls: SearchAlertDigest[] = [];
    const discordCalls: SearchAlertData[] = [];
    const advancedSearches: string[] = [];
    const notifications = [
      makeNotification("search-1"),
      makeNotification("search-2"),
    ];

    const results = await deliverNotificationBatches(
      {
        userId: "user-1",
        email: "user@example.com",
        discordId: "discord-1",
        discordAppInstalled: true,
      },
      notificationBatches(notifications),
      {
        sendEmailDigest: (_recipient, digest) => {
          emailCalls.push(digest);
          return Promise.resolve({ success: true });
        },
        sendDiscordAlert: (_discordId, alert) => {
          discordCalls.push(alert);
          return Promise.resolve({ success: true });
        },
        advanceLastCheckedAt: (searchId) => {
          advancedSearches.push(searchId);
          return Promise.resolve();
        },
        captureNotification: () => undefined,
        runSearchTask: (task) => task(),
      },
    );

    expect(emailCalls).toHaveLength(1);
    expect(emailCalls[0]?.previewAlerts).toEqual(
      notifications.map(({ alertData }) => alertData),
    );
    expect(emailCalls[0]?.alertCount).toBe(2);
    expect(emailCalls[0]?.vehicleCount).toBe(4);
    expect(discordCalls).toEqual(
      notifications.map(({ alertData }) => alertData),
    );
    expect(advancedSearches).toEqual(["search-1", "search-2"]);
    expect(
      results.every(
        (result) =>
          result.kind === "notification" &&
          result.email.kind === "sent" &&
          result.discord.kind === "sent" &&
          result.checkpoint === "advanced",
      ),
    ).toBe(true);
  });

  test("does not advance checkpoints when the shared digest fails", async () => {
    const advancedSearches: string[] = [];
    const notifications = [
      makeNotification("search-1", { discordAlertsEnabled: false }),
      makeNotification("search-2", { discordAlertsEnabled: false }),
    ];

    const results = await deliverNotificationBatches(
      {
        userId: "user-1",
        email: "user@example.com",
        discordId: null,
        discordAppInstalled: false,
      },
      notificationBatches(notifications),
      {
        sendEmailDigest: () =>
          Promise.resolve({ success: false, error: "provider unavailable" }),
        sendDiscordAlert: () => Promise.resolve({ success: true }),
        advanceLastCheckedAt: (searchId) => {
          advancedSearches.push(searchId);
          return Promise.resolve();
        },
        captureNotification: () => undefined,
        runSearchTask: (task) => task(),
      },
    );

    expect(advancedSearches).toEqual([]);
    expect(
      results.every(
        (result) =>
          result.kind === "notification" &&
          result.email.kind === "failed" &&
          result.email.error.includes("provider unavailable") &&
          result.checkpoint === "not_advanced_delivery_error",
      ),
    ).toBe(true);
  });

  test("bounds digest previews across notification batches", async () => {
    const emailCalls: SearchAlertDigest[] = [];
    const notifications = Array.from({ length: 12 }, (_, index) =>
      makeNotification(`search-${index}`, { discordAlertsEnabled: false }),
    );

    await deliverNotificationBatches(
      {
        userId: "user-1",
        email: "user@example.com",
        discordId: null,
        discordAppInstalled: false,
      },
      (async function* () {
        yield notifications.slice(0, 5);
        yield notifications.slice(5, 10);
        yield notifications.slice(10);
      })(),
      {
        sendEmailDigest: (_recipient, digest) => {
          emailCalls.push(digest);
          return Promise.resolve({ success: true });
        },
        sendDiscordAlert: () => Promise.resolve({ success: true }),
        advanceLastCheckedAt: () => Promise.resolve(),
        captureNotification: () => undefined,
        runSearchTask: (task) => task(),
      },
    );

    expect(emailCalls).toHaveLength(1);
    expect(emailCalls[0]?.previewAlerts).toHaveLength(
      MAX_SEARCH_ALERT_DIGEST_PREVIEWS,
    );
    expect(emailCalls[0]?.alertCount).toBe(12);
    expect(emailCalls[0]?.vehicleCount).toBe(24);
  });

  test("continues Discord-only finalization after a checkpoint failure", async () => {
    const checkpointAttempts: string[] = [];
    const notifications = Array.from({ length: 3 }, (_, index) =>
      makeNotification(`search-${index}`, { emailAlertsEnabled: false }),
    );

    const results = await deliverNotificationBatches(
      {
        userId: "user-1",
        email: "user@example.com",
        discordId: "discord-1",
        discordAppInstalled: true,
      },
      notificationBatches(notifications),
      {
        sendEmailDigest: () => Promise.resolve({ success: true }),
        sendDiscordAlert: () => Promise.resolve({ success: true }),
        advanceLastCheckedAt: (searchId) => {
          checkpointAttempts.push(searchId);
          return searchId === "search-0"
            ? Promise.reject(new Error("database unavailable"))
            : Promise.resolve();
        },
        captureNotification: () => undefined,
        runSearchTask: (task) => task(),
      },
    );

    expect(checkpointAttempts).toEqual(["search-0", "search-1", "search-2"]);
    expect(
      results.find(
        (result) =>
          result.kind === "notification" && result.searchId === "search-0",
      ),
    ).toMatchObject({
      checkpoint: "not_advanced_persistence_error",
      checkpointError: "database unavailable",
    });
    expect(
      results.filter(
        (result) =>
          result.kind === "notification" && result.checkpoint === "advanced",
      ),
    ).toHaveLength(2);
  });

  test("continues digest finalization after a checkpoint failure", async () => {
    const checkpointAttempts: string[] = [];
    const notifications = Array.from({ length: 7 }, (_, index) =>
      makeNotification(`search-${index}`, { discordAlertsEnabled: false }),
    );
    let emailCount = 0;

    const results = await deliverNotificationBatches(
      {
        userId: "user-1",
        email: "user@example.com",
        discordId: null,
        discordAppInstalled: false,
      },
      notificationBatches(notifications),
      {
        sendEmailDigest: () => {
          emailCount += 1;
          return Promise.resolve({ success: true });
        },
        sendDiscordAlert: () => Promise.resolve({ success: true }),
        advanceLastCheckedAt: (searchId) => {
          checkpointAttempts.push(searchId);
          return searchId === "search-0"
            ? Promise.reject(new Error("database unavailable"))
            : Promise.resolve();
        },
        captureNotification: () => undefined,
        runSearchTask: (task) => task(),
      },
    );

    expect(emailCount).toBe(1);
    expect(checkpointAttempts).toHaveLength(7);
    expect(results).toHaveLength(7);
    expect(
      results.filter(
        (result) =>
          result.kind === "notification" &&
          result.checkpoint === "not_advanced_persistence_error",
      ),
    ).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.kind === "notification" && result.checkpoint === "advanced",
      ),
    ).toHaveLength(6);
  });
});

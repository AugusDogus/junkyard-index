import { describe, expect, test } from "bun:test";
import type { SearchAlertDigest } from "~/lib/search-alert-data";
import {
  deliverDurableAlertIntentBatch,
  type ClaimedNotificationIntent,
  type DurableAlertDeliveryOperations,
  type NotificationIntentTarget,
} from "./durable-alert-delivery";
import { parseNotificationIntentPayload } from "./notification-intent-payload";

function payload(searchId: string, count: number): string {
  return JSON.stringify({
    searchName: `Search ${searchId}`,
    query: "ford",
    searchUrl: `https://example.com/search?id=${searchId}`,
    searchId,
    match: { count, previewVehicles: [] },
  });
}

function intent(
  id: string,
  searchId: string,
  overrides: Partial<ClaimedNotificationIntent> = {},
): ClaimedNotificationIntent {
  return {
    id,
    runId: "run-1",
    publicationSequence: 7,
    savedSearchId: searchId,
    userId: "user-1",
    channel: "email",
    searchMatchVersion: 2,
    channelConfigVersion: 3,
    payload: payload(searchId, 1),
    status: "sending",
    attempts: 1,
    claimToken: "claim-1",
    claimedAt: new Date("2026-08-23T07:00:00.000Z"),
    nextAttemptAt: null,
    lastError: null,
    createdAt: new Date("2026-08-23T06:00:00.000Z"),
    deliveredAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

function target(
  searchId: string,
  overrides: Partial<NotificationIntentTarget> = {},
): NotificationIntentTarget {
  return {
    searchId,
    userId: "user-1",
    searchMatchVersion: 2,
    emailConfigVersion: 3,
    discordConfigVersion: 4,
    emailAlertsEnabled: true,
    discordAlertsEnabled: true,
    emailStartSequence: 0,
    discordStartSequence: 0,
    email: "driver@example.com",
    discordId: "discord-1",
    discordAppInstalled: true,
    ...overrides,
  };
}

function createOperations(params: {
  emailIntents?: ClaimedNotificationIntent[];
  discordIntents?: ClaimedNotificationIntent[];
  targets: NotificationIntentTarget[];
  emailDelivery?: { success: true } | { success: false; error: string };
}) {
  const cancelled: string[] = [];
  const retried: string[] = [];
  const delivered: string[] = [];
  const sentDigests: Array<{
    digest: SearchAlertDigest;
    idempotencyKey: string;
  }> = [];
  const targetBySearch = new Map(
    params.targets.map((item) => [item.searchId, item] as const),
  );
  let subscriptionChecks = 0;
  let emailClaimed = false;
  let discordClaimed = false;

  const operations: DurableAlertDeliveryOperations = {
    deliveryBatchSize: 20,
    claimEmailGroup: async () => {
      if (emailClaimed) return [];
      emailClaimed = true;
      return params.emailIntents ?? [];
    },
    claimDiscordBatch: async () => {
      if (discordClaimed) return [];
      discordClaimed = true;
      return params.discordIntents ?? [];
    },
    loadTarget: async (searchId) => targetBySearch.get(searchId) ?? null,
    parsePayload: parseNotificationIntentPayload,
    hasActiveSubscription: async () => {
      subscriptionChecks += 1;
      return true;
    },
    sendEmailDigest: async (_recipient, digest, options) => {
      sentDigests.push({ digest, idempotencyKey: options.idempotencyKey });
      return params.emailDelivery ?? { success: true };
    },
    sendDiscordAlert: async () => ({ success: true }),
    cancelIntents: async (intents) => {
      cancelled.push(...intents.map(({ id }) => id));
    },
    retryIntents: async (intents) => {
      retried.push(...intents.map(({ id }) => id));
    },
    markDelivered: async (intents) => {
      delivered.push(...intents.map(({ id }) => id));
    },
  };

  return {
    operations,
    cancelled,
    retried,
    delivered,
    sentDigests,
    subscriptionChecks: () => subscriptionChecks,
  };
}

describe("durable alert delivery", () => {
  test("sends one replay-safe digest for every eligible search in a user publication", async () => {
    const first = intent("email-1", "search-1");
    const second = intent("email-2", "search-2", {
      payload: payload("search-2", 2),
    });
    const harness = createOperations({
      emailIntents: [first, second],
      targets: [target("search-1"), target("search-2")],
    });

    expect(await deliverDurableAlertIntentBatch(harness.operations)).toEqual({
      status: "paused",
      intentsProcessed: 2,
    });
    expect(harness.sentDigests).toHaveLength(1);
    expect(harness.sentDigests[0]?.digest.alertCount).toBe(2);
    expect(harness.sentDigests[0]?.digest.vehicleCount).toBe(3);
    expect(harness.sentDigests[0]?.idempotencyKey).toBe("email:run-1:7:user-1");
    expect(harness.subscriptionChecks()).toBe(1);
    expect(harness.delivered).toEqual(["email-1", "email-2"]);
  });

  test("revalidates each search before assembling the digest", async () => {
    const harness = createOperations({
      emailIntents: [
        intent("email-1", "search-1"),
        intent("email-2", "search-2"),
      ],
      targets: [
        target("search-1"),
        target("search-2", { emailAlertsEnabled: false }),
      ],
    });

    await deliverDurableAlertIntentBatch(harness.operations);

    expect(harness.cancelled).toEqual(["email-2"]);
    expect(harness.sentDigests[0]?.digest.alertCount).toBe(1);
    expect(harness.delivered).toEqual(["email-1"]);
  });

  test("retries the whole eligible digest group after a provider failure", async () => {
    const harness = createOperations({
      emailIntents: [
        intent("email-1", "search-1"),
        intent("email-2", "search-2"),
      ],
      targets: [target("search-1"), target("search-2")],
      emailDelivery: { success: false, error: "provider unavailable" },
    });

    await deliverDurableAlertIntentBatch(harness.operations);

    expect(harness.retried).toEqual(["email-1", "email-2"]);
    expect(harness.delivered).toEqual([]);
  });
});

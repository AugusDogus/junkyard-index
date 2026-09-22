import { describe, expect, test } from "bun:test";
import type {
  SearchAlertData,
  SearchAlertDigest,
} from "~/lib/search-alert-data";
import {
  deliverDurableAlertIntentBatch,
  type ClaimedNotificationIntent,
  type DurableAlertDeliveryOperations,
  type NotificationIntentTarget,
} from "./durable-alert-delivery";
import { parseNotificationIntentPayload } from "./notification-intent-payload";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";
import { algoliaHitToSearchVehicle } from "~/lib/search-vehicles";

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
    deliveryGroupId: "email:run-1:7:user-1",
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
  hasAlertEntitlement?: boolean;
  emailDelivery?: { success: true } | { success: false; error: string };
}) {
  const cancelled: string[] = [];
  const cancellationReasons: string[] = [];
  const retried: string[] = [];
  const delivered: string[] = [];
  const sentDigests: Array<{
    digest: SearchAlertDigest;
    idempotencyKey: string;
  }> = [];
  const sentDiscordAlerts: Array<{
    alert: SearchAlertData;
    idempotencyKey: string;
  }> = [];
  const targetBySearch = new Map(
    params.targets.map((item) => [item.searchId, item] as const),
  );
  const targetLoads: string[][] = [];
  let alertEntitlementChecks = 0;
  let emailClaimed = false;
  let discordClaimed = false;

  const operations: DurableAlertDeliveryOperations = {
    claimEmailGroup: async () => {
      if (emailClaimed) return [];
      emailClaimed = true;
      return params.emailIntents ?? [];
    },
    claimDiscordGroup: async () => {
      if (discordClaimed) return [];
      discordClaimed = true;
      return params.discordIntents ?? [];
    },
    loadTargets: async (searchIds) => {
      targetLoads.push([...searchIds]);
      return searchIds.flatMap((searchId) => {
        const value = targetBySearch.get(searchId);
        return value ? [value] : [];
      });
    },
    parsePayload: parseNotificationIntentPayload,
    hasAlertEntitlement: async () => {
      alertEntitlementChecks += 1;
      return params.hasAlertEntitlement ?? true;
    },
    sendEmailDigest: async (_recipient, digest, options) => {
      sentDigests.push({ digest, idempotencyKey: options.idempotencyKey });
      return params.emailDelivery ?? { success: true };
    },
    sendDiscordAlerts: async (_recipient, alerts, options) => {
      const sentSearchIds: string[] = [];
      for (const alert of alerts) {
        sentDiscordAlerts.push({
          alert,
          idempotencyKey: `${options.idempotencyKey}:${alert.searchId}`,
        });
        if (params.emailDelivery && !params.emailDelivery.success) {
          return {
            success: false,
            error: params.emailDelivery.error,
            sentSearchIds,
          };
        }
        sentSearchIds.push(alert.searchId);
      }
      return { success: true, sentSearchIds };
    },
    cancelIntents: async (intents, reason) => {
      cancelled.push(...intents.map(({ id }) => id));
      cancellationReasons.push(reason);
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
    cancellationReasons,
    retried,
    delivered,
    sentDigests,
    sentDiscordAlerts,
    targetLoads,
    alertEntitlementChecks: () => alertEntitlementChecks,
  };
}

describe("durable alert delivery", () => {
  test.each([...INGESTION_SOURCES])(
    "delivers email and Discord previews containing %s",
    async (source) => {
      const preview = algoliaHitToSearchVehicle({
        objectID: "JG1MR2158JK724014",
        source,
        year: 1988,
        make: "Chevrolet",
        model: "Sprint",
      });
      if (!preview)
        throw new Error(
          "Expected a registered source to produce a search vehicle",
        );
      const body = JSON.stringify({
        searchName: "Search 1",
        query: "chevrolet",
        searchUrl: "https://example.com/search",
        searchId: "search-1",
        match: { count: 1, previewVehicles: [preview] },
      });
      const harness = createOperations({
        emailIntents: [intent("email-1", "search-1", { payload: body })],
        discordIntents: [
          intent("discord-1", "search-1", {
            payload: body,
            channel: "discord",
            channelConfigVersion: 4,
          }),
        ],
        targets: [target("search-1")],
      });
      await deliverDurableAlertIntentBatch(harness.operations);
      await deliverDurableAlertIntentBatch(harness.operations);
      expect(harness.cancelled).toEqual([]);
      expect(harness.delivered).toEqual(["email-1", "discord-1"]);
      expect(harness.sentDigests).toHaveLength(1);
      expect(harness.sentDiscordAlerts).toHaveLength(1);
      expect(
        harness.sentDiscordAlerts[0]?.alert.match.previewVehicles[0]?.source,
      ).toBe(source);
    },
  );
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
    expect(harness.alertEntitlementChecks()).toBe(1);
    expect(harness.delivered).toEqual(["email-1", "email-2"]);
  });

  test("combines publications and repeated searches into one email digest", async () => {
    const intents = [
      intent("a", "search-1"),
      intent("b", "search-1", {
        runId: "run-2",
        publicationSequence: 8,
        payload: payload("search-1", 3),
      }),
      intent("c", "search-2"),
    ];
    const harness = createOperations({
      emailIntents: intents,
      targets: [target("search-1"), target("search-2")],
    });
    await deliverDurableAlertIntentBatch(harness.operations);
    expect(harness.sentDigests).toHaveLength(1);
    expect(harness.sentDigests[0]?.digest.alertCount).toBe(2);
    expect(harness.sentDigests[0]?.digest.vehicleCount).toBe(5);
    expect(harness.sentDigests[0]?.digest.previewAlerts[0]?.match.count).toBe(
      4,
    );
    expect(harness.delivered).toEqual(["a", "b", "c"]);
    expect(harness.targetLoads).toEqual([["search-1", "search-2"]]);
  });

  test("sends one Discord preview message per search in the same daily batch", async () => {
    const intents = [
      intent("a", "search-1", {
        channel: "discord",
        channelConfigVersion: 4,
        deliveryGroupId: "discord:digest:claim-1",
      }),
      intent("b", "search-1", {
        channel: "discord",
        channelConfigVersion: 4,
        deliveryGroupId: "discord:digest:claim-1",
        runId: "run-2",
        publicationSequence: 8,
        payload: payload("search-1", 3),
      }),
      intent("c", "search-2", {
        channel: "discord",
        channelConfigVersion: 4,
        deliveryGroupId: "discord:digest:claim-1",
      }),
    ];
    const harness = createOperations({
      discordIntents: intents,
      targets: [target("search-1"), target("search-2")],
    });
    await deliverDurableAlertIntentBatch(harness.operations);
    expect(harness.sentDiscordAlerts).toHaveLength(2);
    expect(harness.sentDiscordAlerts[0]?.alert.searchId).toBe("search-1");
    expect(harness.sentDiscordAlerts[0]?.alert.match.count).toBe(4);
    expect(harness.sentDiscordAlerts[0]?.idempotencyKey).toBe(
      "discord:digest:claim-1:search-1",
    );
    expect(harness.sentDiscordAlerts[1]?.alert.searchId).toBe("search-2");
    expect(harness.sentDiscordAlerts[1]?.alert.match.count).toBe(1);
    expect(harness.sentDiscordAlerts[1]?.idempotencyKey).toBe(
      "discord:digest:claim-1:search-2",
    );
    expect(harness.delivered).toEqual(["a", "b", "c"]);
    expect(harness.targetLoads).toEqual([["search-1", "search-2"]]);
  });

  test("sends a Discord preview for every search in the daily batch", async () => {
    const intents = Array.from({ length: 12 }, (_, index) =>
      intent(`discord-${index}`, `search-${index}`, {
        channel: "discord",
        channelConfigVersion: 4,
        deliveryGroupId: "discord:digest:claim-1",
        payload: payload(`search-${index}`, 1),
      }),
    );
    const harness = createOperations({
      discordIntents: intents,
      targets: intents.map((item) => target(item.savedSearchId)),
    });
    await deliverDurableAlertIntentBatch(harness.operations);
    expect(harness.sentDiscordAlerts).toHaveLength(12);
    expect(harness.delivered).toHaveLength(12);
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

  test("retries only Discord searches that were not sent", async () => {
    const harness = createOperations({
      discordIntents: [
        intent("discord-1", "search-1", {
          channel: "discord",
          channelConfigVersion: 4,
          deliveryGroupId: "discord:group:claim-1",
        }),
        intent("discord-2", "search-2", {
          channel: "discord",
          channelConfigVersion: 4,
          deliveryGroupId: "discord:group:claim-1",
        }),
      ],
      targets: [target("search-1"), target("search-2")],
    });
    harness.operations.sendDiscordAlerts = async (
      _recipient,
      alerts,
      options,
    ) => {
      const sentSearchIds: string[] = [];
      for (const alert of alerts) {
        harness.sentDiscordAlerts.push({
          alert,
          idempotencyKey: `${options.idempotencyKey}:${alert.searchId}`,
        });
        if (alert.searchId === "search-2") continue;
        sentSearchIds.push(alert.searchId);
      }
      return {
        success: false,
        error: "provider unavailable",
        sentSearchIds,
      };
    };

    await deliverDurableAlertIntentBatch(harness.operations);

    expect(
      harness.sentDiscordAlerts.map((send) => send.alert.searchId),
    ).toEqual(["search-1", "search-2"]);
    expect(harness.delivered).toEqual(["discord-1"]);
    expect(harness.retried).toEqual(["discord-2"]);
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

  test("cancels intents when the account lacks alert entitlement", async () => {
    const harness = createOperations({
      emailIntents: [intent("email-1", "search-1")],
      targets: [target("search-1")],
      hasAlertEntitlement: false,
    });

    await deliverDurableAlertIntentBatch(harness.operations);

    expect(harness.cancelled).toEqual(["email-1"]);
    expect(harness.cancellationReasons).toEqual(["alert_entitlement_missing"]);
    expect(harness.sentDigests).toEqual([]);
  });
});

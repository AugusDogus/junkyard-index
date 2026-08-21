import { describe, expect, test } from "bun:test";
import { SearchAlertMatch } from "~/lib/search-alert-data";
import type { PreparedSearchNotification } from "./deliver-search-notifications";
import type { SearchWithAlerts } from "./search-alert-claim-repository";
import { SearchAlertResult } from "./search-alert-result";
import {
  claimUserSearchGroups,
  processUserSearches,
  type UserSearchProcessingDependencies,
} from "./process-user-searches";

const lockTime = new Date("2026-08-21T07:00:00.000Z");

function makeSearch(id: string, userId = "user-1"): SearchWithAlerts {
  return {
    id,
    userId,
    name: id,
    query: "volvo",
    filters: "{}",
    lastCheckedAt: lockTime,
    emailAlertsEnabled: true,
    discordAlertsEnabled: false,
  };
}

function makeNotification(
  search: SearchWithAlerts,
): PreparedSearchNotification {
  return {
    emailAlertsEnabled: true,
    discordAlertsEnabled: false,
    queryTime: lockTime,
    canAdvanceLastCheckedAt: true,
    alertData: {
      searchId: search.id,
      searchName: search.name,
      query: search.query,
      match: SearchAlertMatch.create(1, []),
      searchUrl: `https://example.com/search/${search.id}`,
    },
  };
}

function createDependencies(
  overrides: Partial<UserSearchProcessingDependencies> = {},
): UserSearchProcessingDependencies {
  return {
    preparationBatchSize: 5,
    loadUserInfo: () =>
      Promise.resolve({
        email: "user@example.com",
        discordId: null,
        discordAppInstalled: false,
      }),
    getSubscriptionState: () => Promise.resolve({ kind: "active" }),
    disableAlertsForInactiveSubscription: () => Promise.resolve([]),
    prepareSearchBatch: () =>
      Promise.resolve({ results: [], notifications: [] }),
    createDeliverySession: () => ({
      acceptBatch: () => Promise.resolve([]),
      finish: () => Promise.resolve([]),
    }),
    releaseClaim: () => Promise.resolve(),
    reportProcessingFailure: () => undefined,
    reportReleaseFailure: () => undefined,
    ...overrides,
  };
}

describe("processUserSearches", () => {
  test("passes two prepared searches through one delivery session", async () => {
    const searches: [SearchWithAlerts, SearchWithAlerts] = [
      makeSearch("search-1"),
      makeSearch("search-2"),
    ];
    const acceptedSearchIds: string[] = [];
    let deliverySessionCount = 0;
    let releaseCount = 0;

    const results = await processUserSearches(
      searches,
      lockTime,
      createDependencies({
        prepareSearchBatch: (batch) =>
          Promise.resolve({
            results: [],
            notifications: batch.map(makeNotification),
          }),
        createDeliverySession: () => {
          deliverySessionCount += 1;
          return {
            acceptBatch: (notifications) => {
              acceptedSearchIds.push(
                ...notifications.map(({ alertData }) => alertData.searchId),
              );
              return Promise.resolve([]);
            },
            finish: () =>
              Promise.resolve(
                searches.map((search) =>
                  SearchAlertResult.notification({
                    searchId: search.id,
                    newVehicleCount: 1,
                    email: { kind: "sent" },
                    discord: { kind: "not_enabled" },
                    canAdvanceLastCheckedAt: true,
                  }),
                ),
              ),
          };
        },
        releaseClaim: () => {
          releaseCount += 1;
          return Promise.resolve();
        },
      }),
    );

    expect(deliverySessionCount).toBe(1);
    expect(acceptedSearchIds).toEqual(["search-1", "search-2"]);
    expect(results).toHaveLength(2);
    expect(releaseCount).toBe(1);
  });

  test("returns retries when the subscription check is unavailable", async () => {
    const searches: [SearchWithAlerts, SearchWithAlerts] = [
      makeSearch("search-1"),
      makeSearch("search-2"),
    ];
    let deliveryCreated = false;

    const results = await processUserSearches(
      searches,
      lockTime,
      createDependencies({
        getSubscriptionState: () =>
          Promise.resolve({
            kind: "unavailable",
            error: new Error("Polar unavailable"),
          }),
        createDeliverySession: () => {
          deliveryCreated = true;
          return {
            acceptBatch: () => Promise.resolve([]),
            finish: () => Promise.resolve([]),
          };
        },
      }),
    );

    expect(deliveryCreated).toBe(false);
    expect(results).toEqual([
      SearchAlertResult.retry("search-1", "subscription_check_unavailable"),
      SearchAlertResult.retry("search-2", "subscription_check_unavailable"),
    ]);
  });

  test("preserves results when claim release fails", async () => {
    const searches: [SearchWithAlerts] = [makeSearch("search-1")];
    const releaseErrors: unknown[] = [];

    const results = await processUserSearches(
      searches,
      lockTime,
      createDependencies({
        loadUserInfo: () => Promise.resolve(null),
        releaseClaim: () => Promise.reject(new Error("database unavailable")),
        reportReleaseFailure: (_userId, _searchIds, error) => {
          releaseErrors.push(error);
        },
      }),
    );

    expect(results).toEqual([
      SearchAlertResult.completed("search-1", "no_user_email"),
    ]);
    expect(releaseErrors).toHaveLength(1);
  });

  test("preserves finalized delivery results when a later batch fails", async () => {
    const searches: [SearchWithAlerts, SearchWithAlerts] = [
      makeSearch("search-1"),
      makeSearch("search-2"),
    ];
    let preparationCount = 0;
    const delivered = SearchAlertResult.notification({
      searchId: "search-1",
      newVehicleCount: 1,
      email: { kind: "not_enabled" },
      discord: { kind: "sent" },
      canAdvanceLastCheckedAt: true,
    });

    const results = await processUserSearches(
      searches,
      lockTime,
      createDependencies({
        preparationBatchSize: 1,
        prepareSearchBatch: () => {
          preparationCount += 1;
          return preparationCount === 1
            ? Promise.resolve({
                results: [],
                notifications: [makeNotification(searches[0])],
              })
            : Promise.reject(new Error("preparation failed"));
        },
        createDeliverySession: () => ({
          acceptBatch: () => Promise.resolve([delivered]),
          finish: () => Promise.resolve([]),
        }),
      }),
    );

    expect(results).toEqual([
      delivered,
      SearchAlertResult.error("search-2", "preparation failed"),
    ]);
  });
});

describe("claimUserSearchGroups", () => {
  test("continues after one user's claim fails", async () => {
    const failures: string[] = [];
    const claims = await claimUserSearchGroups(
      ["user-1", "user-2", "user-3"],
      lockTime,
      (userId) => {
        if (userId === "user-2") {
          return Promise.reject(new Error("database unavailable"));
        }
        return Promise.resolve({
          searches: [makeSearch(`search-${userId}`, userId)],
          lockTime,
        });
      },
      (userId) => failures.push(userId),
    );

    expect(claims.map(({ searches }) => searches[0].userId)).toEqual([
      "user-1",
      "user-3",
    ]);
    expect(failures).toEqual(["user-2"]);
  });
});

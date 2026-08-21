import type {
  PreparedSearchNotification,
  SearchNotificationDeliverySession,
  UserNotificationTarget,
} from "./deliver-search-notifications";
import type {
  SearchWithAlerts,
  UserSearchClaim,
} from "./search-alert-claim-repository";
import { SearchAlertResult } from "./search-alert-result";

export type AlertSubscriptionState =
  | { kind: "active" }
  | { kind: "inactive"; reason: "expired" | "missing" }
  | { kind: "unavailable"; error: unknown };

export interface PreparedSearchBatch {
  results: SearchAlertResult[];
  notifications: PreparedSearchNotification[];
}

interface UserInfo {
  email: string | null;
  discordId: string | null;
  discordAppInstalled: boolean;
}

export interface UserSearchProcessingDependencies {
  preparationBatchSize: number;
  loadUserInfo(userId: string): Promise<UserInfo | null>;
  getSubscriptionState(userId: string): Promise<AlertSubscriptionState>;
  disableAlertsForInactiveSubscription(
    userId: string,
    searches: [SearchWithAlerts, ...SearchWithAlerts[]],
    reason: "expired" | "missing",
  ): Promise<SearchAlertResult[]>;
  prepareSearchBatch(
    searches: SearchWithAlerts[],
    userId: string,
  ): Promise<PreparedSearchBatch>;
  createDeliverySession(
    target: UserNotificationTarget,
  ): SearchNotificationDeliverySession;
  releaseClaim(userId: string, lockTime: Date): Promise<void>;
  reportProcessingFailure(
    userId: string,
    searchIds: string[],
    error: unknown,
  ): void;
  reportReleaseFailure(
    userId: string,
    searchIds: string[],
    error: unknown,
  ): void;
}

function errorResultsForUnresolvedSearches(
  searches: [SearchWithAlerts, ...SearchWithAlerts[]],
  results: SearchAlertResult[],
  error: unknown,
): SearchAlertResult[] {
  const resolvedSearchIds = new Set(results.map((result) => result.searchId));
  const message = error instanceof Error ? error.message : "Unknown error";
  return [
    ...results,
    ...searches
      .filter((search) => !resolvedSearchIds.has(search.id))
      .map((search) => SearchAlertResult.error(search.id, message)),
  ];
}

export async function processUserSearches(
  searches: [SearchWithAlerts, ...SearchWithAlerts[]],
  lockTime: Date,
  dependencies: UserSearchProcessingDependencies,
): Promise<SearchAlertResult[]> {
  const userId = searches[0].userId;
  const searchIds = searches.map((search) => search.id);
  const results: SearchAlertResult[] = [];

  try {
    const userInfo = await dependencies.loadUserInfo(userId);
    if (!userInfo?.email) {
      return searches.map((search) =>
        SearchAlertResult.completed(search.id, "no_user_email"),
      );
    }

    const subscriptionState = await dependencies.getSubscriptionState(userId);
    if (subscriptionState.kind === "inactive") {
      return dependencies.disableAlertsForInactiveSubscription(
        userId,
        searches,
        subscriptionState.reason,
      );
    }
    if (subscriptionState.kind === "unavailable") {
      return searches.map((search) =>
        SearchAlertResult.retry(search.id, "subscription_check_unavailable"),
      );
    }

    const delivery = dependencies.createDeliverySession({
      userId,
      email: userInfo.email,
      discordId: userInfo.discordId,
      discordAppInstalled: userInfo.discordAppInstalled,
    });
    for (
      let index = 0;
      index < searches.length;
      index += dependencies.preparationBatchSize
    ) {
      const batch = await dependencies.prepareSearchBatch(
        searches.slice(index, index + dependencies.preparationBatchSize),
        userId,
      );
      results.push(...batch.results);
      results.push(...(await delivery.acceptBatch(batch.notifications)));
    }
    results.push(...(await delivery.finish()));
    return results;
  } catch (error) {
    dependencies.reportProcessingFailure(userId, searchIds, error);
    return errorResultsForUnresolvedSearches(searches, results, error);
  } finally {
    try {
      await dependencies.releaseClaim(userId, lockTime);
    } catch (error) {
      dependencies.reportReleaseFailure(userId, searchIds, error);
    }
  }
}

export async function claimUserSearchGroups(
  userIds: string[],
  staleLockThreshold: Date,
  claimUserSearches: (
    userId: string,
    staleLockThreshold: Date,
  ) => Promise<UserSearchClaim | null>,
  reportFailure: (userId: string, error: unknown) => void,
): Promise<UserSearchClaim[]> {
  const claims: UserSearchClaim[] = [];
  for (const userId of userIds) {
    try {
      const claim = await claimUserSearches(userId, staleLockThreshold);
      if (claim) claims.push(claim);
    } catch (error) {
      reportFailure(userId, error);
    }
  }
  return claims;
}

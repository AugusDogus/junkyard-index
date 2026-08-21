export type SearchAlertCompletion =
  | "invalid_filters"
  | "first_check_baseline_set"
  | "no_new_vehicles"
  | "no_new_vehicles_partial_scan"
  | "no_user_email"
  | "subscription_expired_disabled"
  | "no_subscription_disabled";

export type SearchAlertRetryReason = "subscription_check_unavailable";

export type AlertChannelResult =
  | { kind: "not_enabled" }
  | { kind: "sent" }
  | { kind: "failed"; error: string };

type SuccessfulAlertChannelResult = Exclude<
  AlertChannelResult,
  { kind: "failed" }
>;

interface SuccessfulNotificationChannels {
  readonly email: SuccessfulAlertChannelResult;
  readonly discord: SuccessfulAlertChannelResult;
}

interface SearchAlertNotificationBase {
  readonly kind: "notification";
  readonly searchId: string;
  readonly newVehicleCount: number;
}

export type SearchAlertNotificationResult = SearchAlertNotificationBase &
  (
    | {
        readonly email: AlertChannelResult;
        readonly discord: AlertChannelResult;
        readonly checkpoint: "not_advanced_incomplete_scan";
      }
    | ({
        readonly checkpoint: "not_advanced_delivery_error";
      } & (
        | {
            readonly email: Extract<AlertChannelResult, { kind: "failed" }>;
            readonly discord: AlertChannelResult;
          }
        | {
            readonly email: SuccessfulAlertChannelResult;
            readonly discord: Extract<AlertChannelResult, { kind: "failed" }>;
          }
      ))
    | (SuccessfulNotificationChannels & {
        readonly checkpoint: "advanced";
      })
    | (SuccessfulNotificationChannels & {
        readonly checkpoint: "not_advanced_persistence_error";
        readonly checkpointError: string;
      })
  );

export type SearchAlertCheckpoint = SearchAlertNotificationResult["checkpoint"];

export type SearchAlertResult =
  | {
      kind: "completed";
      searchId: string;
      outcome: SearchAlertCompletion;
    }
  | { kind: "error"; searchId: string; error: string }
  | { kind: "retry"; searchId: string; reason: SearchAlertRetryReason }
  | SearchAlertNotificationResult;

function channelFailed(result: AlertChannelResult): boolean {
  return result.kind === "failed";
}

export const SearchAlertResult = {
  completed(
    searchId: string,
    outcome: SearchAlertCompletion,
  ): SearchAlertResult {
    return { kind: "completed", searchId, outcome };
  },

  error(searchId: string, error: string): SearchAlertResult {
    return { kind: "error", searchId, error };
  },

  retry(searchId: string, reason: SearchAlertRetryReason): SearchAlertResult {
    return { kind: "retry", searchId, reason };
  },

  notification(params: {
    searchId: string;
    newVehicleCount: number;
    email: AlertChannelResult;
    discord: AlertChannelResult;
    canAdvanceLastCheckedAt: boolean;
  }): SearchAlertNotificationResult {
    const base = {
      kind: "notification",
      searchId: params.searchId,
      newVehicleCount: params.newVehicleCount,
    } as const;
    if (!params.canAdvanceLastCheckedAt) {
      return {
        ...base,
        email: params.email,
        discord: params.discord,
        checkpoint: "not_advanced_incomplete_scan",
      };
    }
    if (params.email.kind === "failed") {
      return {
        ...base,
        email: params.email,
        discord: params.discord,
        checkpoint: "not_advanced_delivery_error",
      };
    }
    if (params.discord.kind === "failed") {
      return {
        ...base,
        email: params.email,
        discord: params.discord,
        checkpoint: "not_advanced_delivery_error",
      };
    }
    return {
      ...base,
      email: params.email,
      discord: params.discord,
      checkpoint: "advanced",
    };
  },

  checkpointPersistenceFailed(
    result: Extract<SearchAlertNotificationResult, { checkpoint: "advanced" }>,
    error: string,
  ): Extract<
    SearchAlertNotificationResult,
    { checkpoint: "not_advanced_persistence_error" }
  > {
    return {
      kind: result.kind,
      searchId: result.searchId,
      newVehicleCount: result.newVehicleCount,
      email: result.email,
      discord: result.discord,
      checkpoint: "not_advanced_persistence_error",
      checkpointError: error,
    };
  },

  hasError(result: SearchAlertResult): boolean {
    return (
      result.kind === "error" ||
      result.kind === "retry" ||
      (result.kind === "notification" &&
        (result.checkpoint === "not_advanced_persistence_error" ||
          channelFailed(result.email) ||
          channelFailed(result.discord)))
    );
  },

  notificationSent(result: SearchAlertResult): boolean {
    return (
      result.kind === "notification" &&
      (result.email.kind === "sent" || result.discord.kind === "sent")
    );
  },
} as const;

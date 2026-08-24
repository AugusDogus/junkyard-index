export type AccountSubscription = {
  id: string;
  cancelAtPeriodEnd: boolean;
};

export type AccountDeletionPreparation =
  | { status: "ready"; stoppedRenewals: number }
  | {
      status: "failed";
      stoppedRenewals: number;
      message: string;
      cause: unknown;
    };

export type AccountSubscriptionOperations = {
  listActive(userId: string): Promise<readonly AccountSubscription[]>;
  stopRenewal(subscriptionId: string): Promise<void>;
};

export async function prepareAccountDeletion(
  userId: string,
  subscriptions: AccountSubscriptionOperations,
): Promise<AccountDeletionPreparation> {
  let activeSubscriptions: readonly AccountSubscription[];

  try {
    activeSubscriptions = await subscriptions.listActive(userId);
  } catch (cause) {
    return {
      status: "failed",
      stoppedRenewals: 0,
      message:
        "We could not verify your subscription status, so your account and data were preserved. Retry account deletion after subscription services recover, or cancel through Manage Subscription first.",
      cause,
    };
  }

  let stoppedRenewals = 0;
  for (const subscription of activeSubscriptions) {
    if (subscription.cancelAtPeriodEnd) continue;

    try {
      await subscriptions.stopRenewal(subscription.id);
      stoppedRenewals += 1;
    } catch (cause) {
      return {
        status: "failed",
        stoppedRenewals,
        message:
          "We could not stop every subscription renewal, so your account and data were preserved. Some renewals may already be canceled. Review Manage Subscription, then retry account deletion.",
        cause,
      };
    }
  }

  return { status: "ready", stoppedRenewals };
}
